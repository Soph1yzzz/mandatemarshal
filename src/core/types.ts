export type SemanticRole =
  | "parent"
  | "routine-implementer"
  | "complex-implementer"
  | "fresh-reviewer";

export type ImplementationLane = Extract<
  SemanticRole,
  "routine-implementer" | "complex-implementer"
>;

export type ReviewVerdict = "PASS" | "FIX" | "ESCALATE";
export type EvidenceTrust = "OBSERVED" | "REPORTED" | "INFERRED" | "UNAVAILABLE";
export type ReasoningEffort = "low" | "medium" | "high" | "max" | string;

export type RunState =
  | "IDLE"
  | "INTAKE"
  | "CONTRACT_CHECK"
  | "PLANNING"
  | "READY_TO_DELEGATE"
  | "IMPLEMENTING"
  | "PARENT_VERIFYING"
  | "FRESH_REVIEWING"
  | "CORRECTION_REQUIRED"
  | "AUTHORITY_CONFLICT"
  | "USER_DECISION_PENDING"
  | "ACCEPTING"
  | "COMPLETED"
  | "BLOCKED"
  | "ABORTED";

export interface OwnerContract {
  id: string;
  level: "owner";
  text: string;
  tags?: string[];
}

export interface RoutingEvidence {
  lane: ImplementationLane;
  reason: string;
  requestedModel?: string;
  requestedEffort?: ReasoningEffort;
  observedModel?: string;
  observedEffort?: ReasoningEffort;
  reclassifiedFrom?: ImplementationLane;
  reclassificationReason?: string;
}

export interface AgentRoutingEvidence {
  role: SemanticRole;
  lane?: ImplementationLane;
  reason: string;
  requestedModel?: string;
  requestedEffort?: ReasoningEffort;
  observedModel?: string;
  observedEffort?: ReasoningEffort;
}

export interface CommandRequirement {
  command: string;
  success?: string;
}

export interface FlagRequirement {
  command: string;
  flag: string;
}

export interface ArtifactRule {
  id: string;
  patterns: string[];
  severity: "blocking" | "warning";
  enabled?: boolean;
}

export type SideEffectRule = string;

export interface ExecutionContract {
  requiredCommands?: CommandRequirement[];
  forbiddenCommands?: string[];
  requiredFlags?: FlagRequirement[];
  forbiddenArtifacts?: ArtifactRule[];
  allowedWritePaths?: string[];
  forbiddenWritePaths?: string[];
  expectedSideEffects?: SideEffectRule[];
  forbiddenSideEffects?: SideEffectRule[];
}

export interface VerificationStep {
  kind: "command" | "inspect" | "artifact" | "custom";
  target: string;
  success: string;
}

export interface ImplementationPacket {
  schemaVersion: 1;
  routing: RoutingEvidence;
  objective: { outcome: string; why?: string };
  ownership: { allowedPaths: string[] };
  interfaces: string[];
  constraints: string[];
  executionContract: ExecutionContract;
  verification: VerificationStep[];
  returnContract: string;
}

export interface CommandEvidence {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  source: "parent" | "implementer" | "hook" | "unknown";
  trust: EvidenceTrust;
}

export interface RepositoryState {
  available: boolean;
  baseRevision?: string;
  status?: string[];
  untracked?: string[];
  digest?: string;
}

export interface ArtifactScanEvidence {
  ruleId: string;
  matchedPaths: string[];
  passed: boolean;
  trust: EvidenceTrust;
}

export interface OwnershipEvidence {
  passed: boolean;
  touchedPaths: string[];
  violations: string[];
  trust: EvidenceTrust;
}

export interface VerificationEvidence {
  target: string;
  passed: boolean;
  detail: string;
  trust: EvidenceTrust;
}

export interface ExecutionEvidence {
  commands: CommandEvidence[];
  beforeState?: RepositoryState;
  afterState?: RepositoryState;
  diff?: string;
  artifactScans?: ArtifactScanEvidence[];
  ownershipCheck?: OwnershipEvidence;
  verificationChecks: VerificationEvidence[];
}

export interface ImplementationReport {
  status: "complete" | "partial" | "blocked";
  routing: RoutingEvidence;
  objective: string;
  changes: string[];
  commands: string[];
  verified: string[];
  judgmentCalls: string[];
  gaps: string[];
  authorityConcerns: string[];
  candidateId?: string;
}

export interface ReviewFinding {
  severity: "blocking" | "warning" | "info";
  reference: string;
  message: string;
}

export interface ReviewResult {
  schemaVersion: 1;
  verdict: ReviewVerdict;
  candidateId: string;
  reason: string;
  findings: ReviewFinding[];
  requiredAction: string;
  residualRisk: string;
}

export interface EscalationOption {
  name: string;
  description: string;
  preservesOwnerContract: boolean;
  benefits?: string[];
  risks?: string[];
  reversibility: "reversible" | "partial" | "irreversible";
}

export interface EscalationPacket {
  schemaVersion: 1;
  source: "parent" | "reviewer";
  conflict: {
    existingRule: string;
    newRequirement: string;
    whyConflict: string;
  };
  investigation: {
    checked: string[];
    simultaneouslySatisfiable: "yes" | "no" | "uncertain";
  };
  options: EscalationOption[];
  recommendation?: string;
  decisionRequired: string;
  heldAction: string;
  safeWorkMayContinue?: string[];
}

export type CommandObservationLevel = "full" | "partial" | "reported-only" | "none";

export interface HostCapabilities {
  freshContext: boolean;
  subagents: boolean;
  persistentChildCorrection: boolean;
  requestedReadOnly: boolean;
  observedReadOnly: boolean;
  exactRoleSelection: boolean;
  exactModelSelection: boolean;
  reasoningSelection: boolean;
  commandObservation: CommandObservationLevel;
  repoStateObservation: boolean;
  worktreeIsolation: boolean;
  hooks: boolean;
  plugins: boolean;
  routingObservation: boolean;
}

export interface WorkerHandle {
  id: string;
  role: ImplementationLane;
  candidateId?: string;
}

export interface ReviewerHandle {
  id: string;
  role: "fresh-reviewer";
  candidateId: string;
}

export interface DurableExecutionContext {
  operationId: string;
  idempotencyKey: string;
}

export interface DurableOperationProbe {
  operationId: string;
  kind: "spawn-implementer" | "spawn-reviewer" | "parent-verify" | "persist-artifacts" | "custom";
  idempotencyKey: string;
  payload?: unknown;
}

export type DurableOperationProbeResult =
  | { outcome: "completed"; detail: string; result?: unknown }
  | { outcome: "not-found"; detail: string }
  | { outcome: "in-progress"; detail: string }
  | { outcome: "unknown"; detail: string };

export interface ImplementerSpawnRequest {
  packet: ImplementationPacket;
  durable?: DurableExecutionContext;
}

export interface ReviewerSpawnRequest {
  candidateId: string;
  objective: string;
  interfaces: string[];
  constraints: string[];
  allowedPaths: string[];
  evidence: ExecutionEvidence;
  durable?: DurableExecutionContext;
}

export interface CorrectionPacket {
  candidateId: string;
  findings: ReviewFinding[];
  requiredAction: string;
}

export interface HostAdapter {
  readonly id: string;
  capabilities(): Promise<HostCapabilities>;
  spawnImplementer(input: ImplementerSpawnRequest): Promise<WorkerHandle>;
  readWorkerResult(handle: WorkerHandle): Promise<ImplementationReport>;
  sendCorrection(handle: WorkerHandle, packet: CorrectionPacket): Promise<void>;
  spawnFreshReviewer(input: ReviewerSpawnRequest): Promise<ReviewerHandle>;
  readReviewerResult(handle: ReviewerHandle): Promise<ReviewResult>;
  observeIsolation?(handle: WorkerHandle | ReviewerHandle): Promise<{
    requestedReadOnly: boolean;
    observedReadOnly: boolean;
    trust: EvidenceTrust;
  }>;
  observeRouting?(handle: WorkerHandle | ReviewerHandle): Promise<AgentRoutingEvidence>;
  observeDurableOperation?(operation: DurableOperationProbe): Promise<DurableOperationProbeResult>;
}

export interface RunEvent<T = unknown> {
  schemaVersion: 1;
  type: string;
  at: string;
  runId: string;
  state: RunState;
  payload?: T;
}

export interface RunMachineSnapshot {
  schemaVersion: 1;
  runId: string;
  state: RunState;
  candidateId?: string;
  freshPassCandidateId?: string;
  pendingEscalation: boolean;
}
