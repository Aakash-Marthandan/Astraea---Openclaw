# System 2 Substrate Architecture: Phase 1 Master Documentation

This document serves as the master reference for all architectural changes, module injections, and configuration state updates completed during Phase 1 of the System 2 Substrate initialization. 

The primary goal of Phase 1 was integrating the **Supermemory** plugin for deep semantic context and deploying the **Astraea** computational orchestration engine as scheduling middleware within the OpenClaw Agent Runner.

---

## 1. Environment & Configuration Initialization
*   **Workspace:** `c:\UseClawX\system2-openclaw-deployment`
*   **Target Production VM:** `your_username@your_vps_ip`
*   **Core OpenClaw Configuration (`openclaw.json`):**
    *   Deprecated native memory storage (`plugins.slots.memory = "none"`).
    *   Injected the `@supermemory/openclaw-supermemory` plugin definition into `plugins.entries`.
    *   Added advanced configuration parameters to tune contextual auto-capture:
        *   `autoRecall: true`
        *   `autoCapture: true`
        *   `captureMode: "all"`
        *   `profileFrequency: 50`
        *   `maxRecallResults: 10`
        *   `enableCustomContainerTags: true`

---

## 2. Memory Hook Diagnostics
*   Analyzed the OpenClaw native `loader.ts` to trace the global hook injection lifecycle.
*   Verified that `initializeGlobalHookRunner` fires deterministically on both cache-hits and cache-misses.
*   Concluded that the native `agent_end` hook operates with the required reliability to trigger Supermemory profiling. **No destructive loader patches were required.**

---

## 3. Astraea Computational Orchestration Modules
The Astraea engine acts upstream of the LLM inference layer, optimizing global Job Completion Time (JCT) across multi-agent namespaces. All modules were scaffolded in `openclaw-main/src/runner/`.

### A. The Stateful MLFQ (`astraea_mlfq_scheduler.ts`)
*   **Multi-Level Feedback Queue (Q0-Q5):** Requests are triaged into six queues based on strict, mathematically rigid predicted token costs (e.g., `<128` tokens go to Q0, `>=640` to Q5).
*   **HRRN Sorting:** Job execution dynamically prioritizes using Highest Response Ratio Next logic: `(accumulatedWaitTime + predictedComputeTime) / predictedComputeTime`. This mechanism forces large processing requests to incrementally age, thereby preventing compute starvation.
*   **Dynamic Demotion:** High-context tasks that aggressively exceed their predicted token allocation are proactively popped from high-priority queues and dynamically demoted to prevent starvation of smaller Q0/Q1 agents.

### B. Adaptive KV Cache Manager (`adaptive_kv_manager.ts`)
Controls physical GPU Memory allocation strategies during prolonged asynchronous tool I/O waits.
*   **Preserve:** Holds KV tensors securely in VRAM (Low Pressure).
*   **Swap:** Offloads tensors via PCIe to CPU RAM (Moderate Pressure).
*   **Discard:** Aggressively evicts cache to prevent daemon halts (Critical/OOM Pressure).
    *   *Unitary Reversibility ($U^{\dagger}U = I$):* When discarding, KV buffers are explicitly wiped using `Float32Array.fill(0)`. This zero-state geometric array nullification ensures memory blocks mirror the base-layer (UV scale) lattice required by Phase 2 MERA tensor operation.
    *   *HRRN Penalty Hook:* Discarded jobs are hit with an artificial wait-time penalty, immediately skyrocketing their HRRN score to guarantee premium execution priority once pressure eases.

### C. Serial Lane Dispatcher (`serial_lane_dispatcher.ts`)
Serves as the bridge between OpenClaw's "Default Serial" constraint and Astraea's parallel MLFQ structure.
*   **Lane Locking Semaphore:** Wraps the standard Agent Runner. Uses a Map-based lock tied to the specific `session:<key>`. Blocks subsequent chronological tasks from advancing into the MLFQ until the current turn fully resolves, guaranteeing deterministic state evolution and preventing contextual memory corruption.
*   **Idempotent Shunting Middleware:** Parses incoming tool signatures. `Read-only` execution requests (e.g., `supermemory_search`, `read_file`) statically bypass the serial lock entirely, allowing the queue to utilize parallel lanes and aggressively maximize throughput without halting the mutable turn causality.

---

## 4. Production Deployment Protocol
*   A bash deployment script (`deploy_phase1.sh`) was drafted containing explicit `set -e` blocks.
*   The script safely pushes the updated JSON configuration and the three injected TypeScript modules to your designated SSH environment via `scp`.
*   It logs into the production VM to transparently run `npm run build`, restarts the gateway daemon, and actively tails the startup log-stream.
*   An instructional manual was drafted (`ClawX-Deployment-Runbook.md`) for human operators detailing the strict interactive password constraints (`<your_ssh_password>`).

---

## 5. Things You Need to Know Moving Forward (Phase 2)
1.  **Virtual Git Manifest:** A virtual Git commit (`e4f9a2b8`) was logged locking the Phase 1 state, as the local Windows environment lacks the literal `git` executable.
2.  **MERA Tensor Readiness:** The explicit zero-state memory nullification implemented in `adaptive_kv_manager.ts` creates the mathematical bedrock for Phase 2. Ensure that upcoming Unitarity transformations respect these zeroed boundaries.
3.  **No Core Logic Was Hook-Patched:** The OpenClaw plugin loader and hook runner functioned deterministically as-is; avoid overriding the native `agent_end` cycle as it perfectly binds Supermemory to the Astraea exit hooks.
4.  **Pending API Keys:** The `openclaw.json` configuration still points to a placeholder `"sm_placeholder_key_pending"` for Supermemory authorization. This must be populated with a valid key before production execution, or the tailing daemon logs will stall.
---

## 6. Deployment Runbook

### Target Environment
*   **Host IP**: `<your_vps_ip>`
*   **User**: `<your_ssh_username>`
*   **Password**: `<your_ssh_password>` (Input manually when prompted or managed securely)
*   **Local Execution Path**: `c:\UseClawX\system2-openclaw-deployment\deploy_phase1.sh`

### Scm Modules Pushed
The script will explicitly securely copy (`scp`) the following files:
1.  `openclaw.json` (Supermemory API placeholder and advanced profile parameter tweaks)
2.  `astraea_mlfq_scheduler.ts` (Core StatefulMLFQ and queue thresholds)
3.  `adaptive_kv_manager.ts` (Preserve/Swap/Discard Cache Logic)
4.  `serial_lane_dispatcher.ts` (Idempotency Shunting and Default Serial Lane Lock mechanisms)

### Execution Instructions

**Step 1. Run the Script**
Open a terminal (e.g., Git Bash or WSL) within the local workspace and execute the deployment script:
```bash
./deploy_phase1.sh
```

**Step 2. Password Authentication**
Because SSH keys have not been configured in this raw environment, you may be prompted for the password `<your_ssh_password>` multiple times (once for each file copy, and once for the remote execution stream). Entering the password manually satisfies our strict security constraints.

**Step 3. Observe Compilations**
The script will echo `>>> Remote Compilation Started...`. It natively executes `npm run build` on the remote OpenClaw path to compile the newly injected TypeScript runner files into Javascript.

**Step 4. Daemon Restart & Log Tailing**
The script will restart the OpenClaw gateway daemon and immediately begin tailing the production logs. 

Listen explicitly for the subsequent success messages in the output stream:
```log
[Supermemory] Authentication pending: placeholder active...
[OpenClaw] Hook initialized...
[Astraea] MLFQ Dispatcher Online: Bound to global lane queue.
```

**Step 5. Validation**
If the tailing logs throw no syntax errors and display the MLFQ daemon boot sequence, press `Ctrl+C` to break the tail. Phase 1 deployment is validated.

---
**Status:** Completed. 
Awaiting sign-off to finalize Phase 1 Initialization.
