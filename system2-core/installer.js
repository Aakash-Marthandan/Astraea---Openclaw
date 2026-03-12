const fs = require('fs');
const path = require('path');

const OPENCLAW_QUEUE_PATH = path.join(__dirname, '..', 'openclaw-main', 'src', 'process', 'command-queue.ts');
const SYSTEM2_RUNTIME_DIR = path.join(__dirname, '..', 'openclaw-main', 'src', 'runner');
const BACKUP_PATH = OPENCLAW_QUEUE_PATH + '.vanilla.bak';

const PROXY_PATCH = `
import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";

// [System 2] Dynamic Proxy Hook Configuration
const SYSTEM2_ENABLED = process.env.SYSTEM2_ENABLED === "true";

export class CommandLaneClearedError extends Error {
  constructor(lane?: string) {
    super(lane ? \`Command lane "\${lane}" cleared\` : "Command lane cleared");
    this.name = "CommandLaneClearedError";
  }
}

export class GatewayDrainingError extends Error {
  constructor() {
    super("Gateway is draining for restart; new tasks are not accepted");
    this.name = "GatewayDrainingError";
  }
}

let gatewayDraining = false;

// [System 2] Native imports for Astraea Substrate
import { SerialLaneDispatcher } from "../runner/serial_lane_dispatcher.js";
import { StatefulMLFQ } from "../runner/astraea_mlfq_scheduler.js";

export const astraeaMlfq = new StatefulMLFQ();
export const astraeaDispatcher = new SerialLaneDispatcher(astraeaMlfq);

if (SYSTEM2_ENABLED) {
    console.log("[Astraea] MLFQ Dispatcher Online: Bound to global lane queue.");
} else {
    console.log("[OpenClaw] Native Chronological Queue Active. System 2 Disabled.");
}

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
  onWait?: (waitMs: number, queuedAhead: number) => void;
};

type LaneState = {
  lane: string;
  queue: QueueEntry[];
  activeTaskIds: Set<number>;
  maxConcurrent: number;
  draining: boolean;
  generation: number;
};

const lanes = new Map<string, LaneState>();
let nextTaskId = 1;

function getLaneState(lane: string): LaneState {
  const existing = lanes.get(lane);
  if (existing) {
    return existing;
  }
  const created: LaneState = {
    lane,
    queue: [],
    activeTaskIds: new Set(),
    maxConcurrent: 1,
    draining: false,
    generation: 0,
  };
  lanes.set(lane, created);
  return created;
}

function completeTask(state: LaneState, taskId: number, taskGeneration: number): boolean {
  if (taskGeneration !== state.generation) {
    return false;
  }
  state.activeTaskIds.delete(taskId);
  return true;
}

function drainLane(lane: string) {
  const state = getLaneState(lane);
  if (state.draining) {
    if (SYSTEM2_ENABLED && state.activeTaskIds.size === 0 && !astraeaMlfq.isGloballyEmpty()) {
      diag.warn(\`drainLane blocked: lane=\${lane} draining=true active=0\`);
    } else if (!SYSTEM2_ENABLED && state.activeTaskIds.size === 0 && state.queue.length > 0) {
      diag.warn(\`drainLane blocked: lane=\${lane} draining=true active=0\`);
    }
    return;
  }
  state.draining = true;

  const pump = () => {
    try {
      while (state.activeTaskIds.size < state.maxConcurrent) {
        let entry: QueueEntry;
        let jobTargetLane = lane;

        if (SYSTEM2_ENABLED) {
            const job = astraeaMlfq.getNextJob();
            if (!job) break;
            entry = job.payload as QueueEntry;
            jobTargetLane = job.targetAgentId;
        } else {
            if (state.queue.length === 0) break;
            entry = state.queue.shift()!;
        }

        const waitedMs = Date.now() - entry.enqueuedAt;
        if (waitedMs >= entry.warnAfterMs) {
          try {
            entry.onWait?.(waitedMs, SYSTEM2_ENABLED ? 0 : state.queue.length);
          } catch (err) {
            diag.error(\`lane onWait callback failed: lane=\${jobTargetLane} error="\${String(err)}"\`);
          }
        }
        logLaneDequeue(jobTargetLane, waitedMs, SYSTEM2_ENABLED ? 0 : state.queue.length);
        const taskId = nextTaskId++;
        const taskGeneration = state.generation;
        state.activeTaskIds.add(taskId);
        
        void (async () => {
          const startTime = Date.now();
          try {
            const result = await entry.task();
            const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);

            if (SYSTEM2_ENABLED) {
                astraeaDispatcher.releaseLane(jobTargetLane);
                drainLane(jobTargetLane);
            }

            if (completedCurrentGeneration) {
              pump();
            }
            entry.resolve(result);
          } catch (err) {
            const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);

            if (SYSTEM2_ENABLED) {
                astraeaDispatcher.releaseLane(jobTargetLane);
                drainLane(jobTargetLane);
            }

            const isProbeLane = jobTargetLane.startsWith("auth-probe:") || jobTargetLane.startsWith("session:probe-");
            if (!isProbeLane) {
              diag.error(\`lane task error: lane=\${jobTargetLane} durationMs=\${Date.now() - startTime} error="\${String(err)}"\`);
            }
            if (completedCurrentGeneration) {
              pump();
            }
            entry.reject(err);
          }
        })();
      }
    } finally {
      state.draining = false;
      if (SYSTEM2_ENABLED) {
          if (!astraeaMlfq.isGloballyEmpty()) {
              setTimeout(() => drainLane(lane), 0);
          }
      } else {
          if (state.queue.length > 0) {
              setTimeout(() => drainLane(lane), 0);
          }
      }
    }
  };

  pump();
}

export function markGatewayDraining(): void {
  gatewayDraining = true;
}

export function setCommandLaneConcurrency(lane: string, maxConcurrent: number) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}

export function enqueueCommandInLane<T>(
  lane: string,
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  if (gatewayDraining) {
    return Promise.reject(new GatewayDrainingError());
  }
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2_000;
  const state = getLaneState(cleaned);
  return new Promise<T>((resolve, reject) => {
    const queueEntry = {
      task: () => task(),
      resolve: (value: unknown) => resolve(value as T),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
    };

    if (SYSTEM2_ENABLED) {
        const job = {
            id: Math.random().toString(36).substring(7),
            targetAgentId: cleaned,
            payload: queueEntry,
            state: {
              accumulatedWaitTime: 0,
              predictedProcessingTime: 128,
              ioWaitState: false,
              turnCount: 0,
              priorityLevel: 0
            }
        };
        astraeaDispatcher.dispatchToLane(job);
    } else {
        state.queue.push(queueEntry);
    }

    logLaneEnqueue(cleaned, state.activeTaskIds.size + (SYSTEM2_ENABLED ? 1 : state.queue.length));
    drainLane(cleaned);
  });
}

export function enqueueCommand<T>(
  task: () => Promise<T>,
  opts?: {
    warnAfterMs?: number;
    onWait?: (waitMs: number, queuedAhead: number) => void;
  },
): Promise<T> {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}

export function getQueueSize(lane: string = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return state.queue.length + state.activeTaskIds.size;
}

export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.activeTaskIds.size;
  }
  return total;
}

export function clearCommandLane(lane: string = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const removed = state.queue.length;
  const pending = state.queue.splice(0);
  for (const entry of pending) {
    entry.reject(new CommandLaneClearedError(cleaned));
  }
  return removed;
}

export function resetAllLanes(): void {
  gatewayDraining = false;
  const lanesToDrain: string[] = [];
  for (const state of lanes.values()) {
    state.generation += 1;
    state.activeTaskIds.clear();
    state.draining = false;
    if (state.queue.length > 0) {
      lanesToDrain.push(state.lane);
    }
  }
  for (const lane of lanesToDrain) {
    drainLane(lane);
  }
}

export function getActiveTaskCount(): number {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.activeTaskIds.size;
  }
  return total;
}

export function waitForActiveTasks(timeoutMs: number): Promise<{ drained: boolean }> {
  const POLL_INTERVAL_MS = 50;
  const deadline = Date.now() + timeoutMs;
  const activeAtStart = new Set<number>();
  for (const state of lanes.values()) {
    for (const taskId of state.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }

  return new Promise((resolve) => {
    const check = () => {
      if (activeAtStart.size === 0) {
        resolve({ drained: true });
        return;
      }

      let hasPending = false;
      for (const state of lanes.values()) {
        for (const taskId of state.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true;
            break;
          }
        }
        if (hasPending) {
          break;
        }
      }

      if (!hasPending) {
        resolve({ drained: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false });
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}
`;

function install() {
    console.log("[System 2 Installer] Injecting standalone Substrate into OpenClaw...");
    
    // Backup Vanilla
    if (!fs.existsSync(BACKUP_PATH) && fs.existsSync(OPENCLAW_QUEUE_PATH)) {
        fs.copyFileSync(OPENCLAW_QUEUE_PATH, BACKUP_PATH);
        console.log("-> Vanilla command-queue.ts backed up safely.");
    }
    
    // Symlink / Copy Core Runner Files
    if (!fs.existsSync(SYSTEM2_RUNTIME_DIR)) {
        fs.mkdirSync(SYSTEM2_RUNTIME_DIR, { recursive: true });
    }
    fs.copyFileSync(path.join(__dirname, 'astraea_mlfq_scheduler.ts'), path.join(SYSTEM2_RUNTIME_DIR, 'astraea_mlfq_scheduler.ts'));
    fs.copyFileSync(path.join(__dirname, 'serial_lane_dispatcher.ts'), path.join(SYSTEM2_RUNTIME_DIR, 'serial_lane_dispatcher.ts'));
    fs.copyFileSync(path.join(__dirname, 'adaptive_kv_manager.ts'), path.join(SYSTEM2_RUNTIME_DIR, 'adaptive_kv_manager.ts'));

    console.log("-> System 2 Substrate runner files transported.");

    // Inject Runtime Proxy Hook
    fs.writeFileSync(OPENCLAW_QUEUE_PATH, PROXY_PATCH);
    console.log("-> Routing Proxy injected into OpenClaw Command Queue successfully.");
    console.log("[System 2 Installer] Complete. Toggle routing on boot via SYSTEM2_ENABLED=true in .env");
}

function uninstall() {
    console.log("[System 2 Installer] Removing Substrate from OpenClaw...");
    
    if (fs.existsSync(BACKUP_PATH)) {
        fs.copyFileSync(BACKUP_PATH, OPENCLAW_QUEUE_PATH);
        fs.unlinkSync(BACKUP_PATH);
        console.log("-> Restored native OpenClaw command-queue.ts from backup.");
    }

    try {
        fs.unlinkSync(path.join(SYSTEM2_RUNTIME_DIR, 'astraea_mlfq_scheduler.ts'));
        fs.unlinkSync(path.join(SYSTEM2_RUNTIME_DIR, 'serial_lane_dispatcher.ts'));
        fs.unlinkSync(path.join(SYSTEM2_RUNTIME_DIR, 'adaptive_kv_manager.ts'));
        console.log("-> System 2 Substrate runner files deleted from OpenClaw module.");
    } catch (e) {
        console.log("-> No runner files found to delete.");
    }

    console.log("[System 2 Installer] Complete. OpenClaw source is returned to a 100% pure state.");
}

const args = process.argv.slice(2);
if (args[0] === '--install') {
    install();
} else if (args[0] === '--uninstall') {
    uninstall();
} else {
    console.log("Usage: node installer.js [--install | --uninstall]");
}
