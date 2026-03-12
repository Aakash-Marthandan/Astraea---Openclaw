import { StatefulMLFQ, OrchestrationJob } from './astraea_mlfq_scheduler.js';

/**
 * Ensures deterministic chronological state evolution by enforcing
 * strict Serial execution lanes within the MLFQ structure, while allowing
 * asynchronous shunting for recognized idempotent tool requests.
 */
export class SerialLaneDispatcher {
    private mlfq: StatefulMLFQ;

    // Map tracking active execution presence per session lane
    // Key: targetAgentId (Session Lane), Value: boolean (Is Locked)
    private activeLanes: Map<string, boolean>;

    // Queue of pending jobs blocked by an actively locked lane
    private pendingLaneJobs: Map<string, Array<OrchestrationJob>>;

    // Pre-defined set of read-only, idempotent tools safe for parallel execution
    private static readonly IDEMPOTENT_TOOLS = new Set([
        'supermemory_search',
        'web_scrape',
        'read_file',
        'check_weather',
        'get_system_status'
    ]);

    constructor(mlfqScheduler: StatefulMLFQ) {
        this.mlfq = mlfqScheduler;
        this.activeLanes = new Map();
        this.pendingLaneJobs = new Map();
    }

    /**
     * Idempotency Checker Middleware: Evaluates the incoming tool execution payload.
     * Returns true if the task is explicitly flagged as read-only/idempotent.
     */
    private isIdempotentTask(job: OrchestrationJob): boolean {
        // Assume the tool name is embedded in the payload for scaffolding purposes
        const targetTool = job.payload?.tool_name;
        return targetTool && SerialLaneDispatcher.IDEMPOTENT_TOOLS.has(targetTool);
    }

    /**
     * Attempts to dispatch a job into the MLFQ.
     * Idempotent tasks are shunted directly to parallel lanes, bypassing session locks.
     * Mutable tasks queue in holding if the lane is locked to enforce "Default Serial" constraint.
     */
    public dispatchToLane(job: OrchestrationJob): void {
        const laneId = job.targetAgentId;

        // Idempotency Shunting: Bypass the serial lock
        if (this.isIdempotentTask(job)) {
            // Drop into explicit parallel lane. Fills Q0/Q1 compute voids during I/O waits.
            this.mlfq.emit('enqueue', job);
            return;
        }

        if (this.isLaneLocked(laneId)) {
            // Lane is actively processing a chronological turn; push to pending
            if (!this.pendingLaneJobs.has(laneId)) {
                this.pendingLaneJobs.set(laneId, []);
            }
            this.pendingLaneJobs.get(laneId)!.push(job);
        } else {
            // Lane is free; lock the lane and push directly to Astraea MLFQ
            this.lockLane(laneId);
            this.mlfq.emit('enqueue', job);
        }
    }

    /**
     * Resolves the lane lock after the Supermemory autoCapture hook completes.
     * Shifts the next pending chronological job into the active MLFQ.
     */
    public releaseLane(laneId: string): void {
        this.activeLanes.set(laneId, false);

        // Check if chronological jobs are waiting on this specific lane
        const pendingQueue = this.pendingLaneJobs.get(laneId);
        if (pendingQueue && pendingQueue.length > 0) {
            // Shift the chronologically oldest waiting job
            const nextJob = pendingQueue.shift()!;

            // Relock and dispatch
            this.lockLane(laneId);
            this.mlfq.emit('enqueue', nextJob);
        }
    }

    private isLaneLocked(laneId: string): boolean {
        return this.activeLanes.get(laneId) === true;
    }

    private lockLane(laneId: string): void {
        this.activeLanes.set(laneId, true);
    }

    /**
     * Failsafe cleanup to prevent permanent deadlocks if an agent process
     * hard-crashes without triggering the proper release hooks.
     */
    public forceUnlockLane(laneId: string): void {
        if (this.isLaneLocked(laneId)) {
            console.warn(`[Astraea] Forced unlock on lane ${laneId} due to timeout/crash.`);
            this.releaseLane(laneId);
        }
    }
}
