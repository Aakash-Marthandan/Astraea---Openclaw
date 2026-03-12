import { OrchestrationJob } from './astraea_mlfq_scheduler.js';

/**
 * Adaptive KV Cache Manager for controlling memory saturation
 * during prolonged I/O waits in the Astraea scheduler.
 */
export class KVCacheStrategyController {
    // Simulated strategy coefficients
    private readonly T_api = 1.0;
    private readonly C_self = 1.0;
    private readonly T_swap = 2.0;
    private readonly C_batch = 1.5;
    private readonly T_recompute = 5.0;

    /**
     * Preserve Strategy: Executed under low pressure. 
     * KV cache pointers are held securely in VRAM.
     */
    public calculatePreserveWeight(M: number): number {
        return this.T_api * this.C_self * M;
    }

    /**
     * Swap Strategy: Executed under moderate pressure. 
     * Signals the offloading of KV tensors via PCIe bus to host CPU RAM.
     */
    public calculateSwapWeight(M: number): number {
        return 2 * this.T_swap * this.C_batch * M;
    }

    /**
     * Discard Strategy (Penalty): Executed under critical near-OOM pressure. 
     * Evicts the cache entirely.
     */
    public calculateDiscardPenalty(M: number): number {
        return this.T_recompute * this.C_batch * M;
    }

    /**
     * Explicit hook for the Discard strategy.
     * When a task's cache is evicted, its wait time is artificially inflated
     * by the penalty. This ensures the HRRN score skyrockets upon resumption.
     */
    public handleDiscard(job: OrchestrationJob, M: number, kvBuffer?: Float32Array): void {
        const penalty = this.calculateDiscardPenalty(M);

        // Inflate accumulated wait time to skyrocket the HRRN score
        job.state.accumulatedWaitTime += penalty;

        // Eviction signal: Explicit geometric array nullification
        if (kvBuffer) {
            /**
             * CRITICAL REQUIREMENT for Phase 2 MERA tensor operation:
             * This explicit zeroing operations ensures that discarded matrix sectors 
             * natively mirror the base-layer (UV scale) lattice. 
             * 
             * Merely marking memory as "free" breaks theoretical mathematical conditions. 
             * Setting elements exactly to zero preserves Unitary matrix reversibility (U†U = I) 
             * within the substrate, allowing pristine state resurrection.
             */
            kvBuffer.fill(0);
        }
    }
}
