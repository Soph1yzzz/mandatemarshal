import type {
  CorrectionPacket,
  HostAdapter,
  HostCapabilities,
  ImplementationReport,
  ImplementerSpawnRequest,
  ReviewerHandle,
  ReviewerSpawnRequest,
  ReviewResult,
  WorkerHandle,
} from "../../core/types";

const DEFAULT_CAPABILITIES: HostCapabilities = {
  freshContext: true,
  subagents: true,
  persistentChildCorrection: true,
  requestedReadOnly: true,
  observedReadOnly: true,
  exactRoleSelection: true,
  exactModelSelection: true,
  reasoningSelection: true,
  commandObservation: "full",
  repoStateObservation: true,
  worktreeIsolation: true,
  hooks: true,
  plugins: true,
  routingObservation: true,
};

export class MockAdapter implements HostAdapter {
  readonly id = "mock";
  readonly spawnedLanes: string[] = [];
  readonly reviewCandidates: string[] = [];
  readonly corrections: CorrectionPacket[] = [];
  private workerCounter = 0;
  private reviewerCounter = 0;
  private readonly workers = new Map<string, ImplementationReport>();
  private readonly reviewers = new Map<string, ReviewResult>();

  constructor(
    private readonly implementationQueue: ImplementationReport[],
    private readonly reviewQueue: ReviewResult[],
    private readonly caps: HostCapabilities = DEFAULT_CAPABILITIES,
  ) {}

  async capabilities(): Promise<HostCapabilities> {
    return { ...this.caps };
  }

  async spawnImplementer(input: ImplementerSpawnRequest): Promise<WorkerHandle> {
    const result = this.implementationQueue.shift();
    if (!result) throw new Error("Mock implementation queue exhausted");
    const id = `worker-${++this.workerCounter}`;
    this.spawnedLanes.push(input.packet.routing.lane);
    this.workers.set(id, result);
    return {
      id,
      role: input.packet.routing.lane,
      ...(result.candidateId === undefined ? {} : { candidateId: result.candidateId }),
    };
  }

  async readWorkerResult(handle: WorkerHandle): Promise<ImplementationReport> {
    const result = this.workers.get(handle.id);
    if (!result) throw new Error(`Unknown mock worker: ${handle.id}`);
    return result;
  }

  async sendCorrection(_handle: WorkerHandle, packet: CorrectionPacket): Promise<void> {
    this.corrections.push(packet);
  }

  async spawnFreshReviewer(input: ReviewerSpawnRequest): Promise<ReviewerHandle> {
    if (!this.caps.freshContext) throw new Error("REVIEW_CAPABILITY_UNAVAILABLE");
    const result = this.reviewQueue.shift();
    if (!result) throw new Error("Mock review queue exhausted");
    const id = `reviewer-${++this.reviewerCounter}`;
    this.reviewCandidates.push(input.candidateId);
    this.reviewers.set(id, result);
    return { id, role: "fresh-reviewer", candidateId: input.candidateId };
  }

  async readReviewerResult(handle: ReviewerHandle): Promise<ReviewResult> {
    const result = this.reviewers.get(handle.id);
    if (!result) throw new Error(`Unknown mock reviewer: ${handle.id}`);
    return result;
  }
}
