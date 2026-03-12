import { EventEmitter } from 'events';

/**
 * Tracks the state of a job requested to Astraea, unifying historical 
 * workflow behavior with predicted token costs.
 */
export interface JobStateTracker {
    accumulatedWaitTime: number;
    predictedProcessingTime: number;
    ioWaitState: boolean;
    turnCount: number;
    priorityLevel: number;
}

/**
 * Represents a queued request intercepted before hitting the LLM inference engine.
 */
export interface OrchestrationJob {
    id: string;
    targetAgentId: string;
    payload: Record<string, any>;
    state: JobStateTracker;
}

/**
 * Foundational Stateful Multi-Level Feedback Queue for Astraea.
 * Designed to optimize global Job Completion Time (JCT) by dynamically routing
 * requests before they hit the underlying LLM inference engine.
 */
export class StatefulMLFQ extends EventEmitter {
    // Hardcoded, mathematically rigid queue boundaries for Q0-Q5
    private static readonly QUEUE_THRESHOLDS = [
        128,  // Level 0 (Q0): < 128 tokens
        256,  // Level 1 (Q1): < 256 tokens
        384,  // Level 2 (Q2): < 384 tokens
        512,  // Level 3 (Q3): < 512 tokens
        640   // Level 4 (Q4): < 640 tokens
        // Level 5 (Q5): >= 640 tokens
    ];

    // Data structures for managing the multi-level queues
    private activeQueues: Map<number, Array<OrchestrationJob>>;
    private isEngineIdle: boolean = true;

    constructor(levels: number = 6) {
        super();
        this.activeQueues = new Map();
        for (let i = 0; i < levels; i++) {
            this.activeQueues.set(i, []);
        }

        this.bindEmitterHooks();
    }

    /**
     * Evaluates an incoming token estimation and returns the appropriate queue index (0 through 5).
     */
    public classifyRequest(predictedTokens: number): number {
        for (let i = 0; i < StatefulMLFQ.QUEUE_THRESHOLDS.length; i++) {
            if (predictedTokens < StatefulMLFQ.QUEUE_THRESHOLDS[i]) {
                return i;
            }
        }
        // If it exceeds all thresholds, it falls into the lowest priority queue (Q5)
        return StatefulMLFQ.QUEUE_THRESHOLDS.length;
    }

    /**
     * Asynchronously pops the job from its current queue and pushes it to a lower-priority queue 
     * (higher index) based on actual tokens evolved, preventing starvation of Q0/Q1 tasks.
     */
    public handleDemotion(job: OrchestrationJob, actualTokensEvolved: number): void {
        const targetQueueIndex = Math.max(
            job.state.priorityLevel,
            this.classifyRequest(actualTokensEvolved)
        );

        if (targetQueueIndex > job.state.priorityLevel) {
            const currentQueue = this.activeQueues.get(job.state.priorityLevel);
            if (currentQueue) {
                // Find and pop the job from its current queue
                const jobIndex = currentQueue.findIndex(j => j.id === job.id);
                if (jobIndex !== -1) {
                    currentQueue.splice(jobIndex, 1);

                    // Update priority and push to the lower-priority queue
                    job.state.priorityLevel = targetQueueIndex;
                    this.activeQueues.get(targetQueueIndex)?.push(job);
                }
            }
        }
    }

    /**
     * Intercepts OpenClaw's existing Lane Queue event emitters.
     */
    private bindEmitterHooks(): void {
        this.on('enqueue', this.handleEnqueue.bind(this));
        this.on('dequeue', this.handleDequeue.bind(this));
        this.on('stall', this.handleStall.bind(this));
    }

    private handleEnqueue(job: OrchestrationJob, initialLevel?: number): void {
        // Evaluate predicted tokens if initialLevel is not explicitly provided
        const level = initialLevel ?? this.classifyRequest(job.state.predictedProcessingTime);
        job.state.priorityLevel = level;

        const queue = this.activeQueues.get(level);
        if (queue) {
            queue.push(job);

            if (this.isEngineIdle) {
                this.isEngineIdle = false;
                this.emit('dequeue', job.id);
            }
        }
    }

    /**
     * Calculates the Highest Response Ratio Next (HRRN) score to gracefully
     * age tasks and prevent starvation of large processing jobs.
     * Score_HRRN = (accumulatedWaitTime + predictedProcessingTime) / predictedProcessingTime
     */
    public calculateHRRNScore(job: OrchestrationJob): number {
        // Prevent division by zero if processing time prediction fails/is zero
        const computeTime = Math.max(job.state.predictedProcessingTime, 1);
        return (job.state.accumulatedWaitTime + computeTime) / computeTime;
    }

    /**
     * Determines the optimal next job from the queue structure.
     * Iterates from highest priority (Q0) down. If a queue is populated,
     * it evaluates all ready segments and extracts the one with the highest HRRN score.
     */
    public getNextJob(): OrchestrationJob | null {
        for (let i = 0; i < StatefulMLFQ.QUEUE_THRESHOLDS.length + 1; i++) {
            const queue = this.activeQueues.get(i);
            if (queue && queue.length > 0) {
                let highestScoreIdx = 0;
                let highestScore = -1;

                // Evaluate HRRN scores dynamically
                for (let j = 0; j < queue.length; j++) {
                    const score = this.calculateHRRNScore(queue[j]);
                    if (score > highestScore) {
                        highestScore = score;
                        highestScoreIdx = j;
                    }
                }

                // Extract and return the job with the highest ratio
                const bestJob = queue[highestScoreIdx];
                queue.splice(highestScoreIdx, 1);
                return bestJob;
            }
        }

        this.isEngineIdle = true;
        return null; // All queues are empty
    }

    /**
     * Helper to verify if any queue bucket currently possesses waiting payloads.
     */
    public isGloballyEmpty(): boolean {
        for (let i = 0; i < StatefulMLFQ.QUEUE_THRESHOLDS.length + 1; i++) {
            const queue = this.activeQueues.get(i);
            if (queue && queue.length > 0) {
                return false;
            }
        }
        return true;
    }

    private handleDequeue(jobId: string): OrchestrationJob | null {
        // Scaffolding: Remove job from queues to dispatch to LLM engine.
        // We now use getNextJob to definitively pull the optimal task.
        return null; // Fixed: Do not preemptively pop jobs into the void.
    }

    private handleStall(jobId: string): void {
        // Scaffolding: Handle IO waits or async tool result pauses by preempting
        // and re-evaluating priority.
    }
}
