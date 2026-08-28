import type {
  EscalationPacket,
  ImplementationPacket,
  ReviewResult,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateImplementationPacket(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["packet must be an object"] };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!isRecord(value.routing)) errors.push("routing is required");
  else {
    if (!isLane(value.routing.lane)) errors.push("routing.lane must be a semantic implementation lane");
    if (!nonEmpty(value.routing.reason)) errors.push("routing.reason is required");
  }
  if (!isRecord(value.objective) || !nonEmpty(value.objective.outcome)) errors.push("objective.outcome is required");
  if (!isRecord(value.ownership) || !isNonEmptyStringArray(value.ownership.allowedPaths)) errors.push("ownership.allowedPaths must be non-empty");
  if (!Array.isArray(value.interfaces)) errors.push("interfaces must be an array");
  if (!Array.isArray(value.constraints)) errors.push("constraints must be an array");
  if (!isRecord(value.executionContract)) errors.push("executionContract is required");
  if (!Array.isArray(value.verification) || value.verification.length === 0) errors.push("verification must be non-empty");
  if (!nonEmpty(value.returnContract)) errors.push("returnContract is required");
  return { valid: errors.length === 0, errors };
}

export function validateReviewResult(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["review must be an object"] };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!(["PASS", "FIX", "ESCALATE"] as const).includes(value.verdict as never)) errors.push("invalid review verdict");
  if (!nonEmpty(value.candidateId)) errors.push("candidateId is required");
  if (!nonEmpty(value.reason)) errors.push("reason is required");
  if (!Array.isArray(value.findings)) errors.push("findings must be an array");
  if (typeof value.requiredAction !== "string") errors.push("requiredAction must be a string");
  if (typeof value.residualRisk !== "string") errors.push("residualRisk must be a string");
  return { valid: errors.length === 0, errors };
}

export function validateEscalationPacket(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["escalation must be an object"] };
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (value.source !== "parent" && value.source !== "reviewer") errors.push("source must be parent or reviewer");
  if (!isRecord(value.conflict)) errors.push("conflict is required");
  if (!isRecord(value.investigation)) errors.push("investigation is required");
  if (!Array.isArray(value.options)) errors.push("options must be an array");
  if (!nonEmpty(value.decisionRequired)) errors.push("decisionRequired is required");
  if (!nonEmpty(value.heldAction)) errors.push("heldAction is required");
  return { valid: errors.length === 0, errors };
}

export function assertImplementationPacket(value: unknown): asserts value is ImplementationPacket {
  const result = validateImplementationPacket(value);
  if (!result.valid) throw new Error(`Invalid implementation packet: ${result.errors.join("; ")}`);
}

export function assertReviewResult(value: unknown): asserts value is ReviewResult {
  const result = validateReviewResult(value);
  if (!result.valid) throw new Error(`Invalid review result: ${result.errors.join("; ")}`);
}

export function assertEscalationPacket(value: unknown): asserts value is EscalationPacket {
  const result = validateEscalationPacket(value);
  if (!result.valid) throw new Error(`Invalid escalation packet: ${result.errors.join("; ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function isLane(value: unknown): boolean {
  return value === "routine-implementer" || value === "complex-implementer";
}
