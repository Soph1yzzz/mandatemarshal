import type { ArtifactRule, HostCapabilities, OwnerContract } from "./core/types";
import { COMPLEXITY_TRIGGERS, type ComplexityTrigger } from "./orchestrator/routing";
import type { CodexNativeRoleConfig } from "./adapters/codex/role-mapping";

export interface CommandPolicyConfig {
  id: string;
  command: string;
  requiredFlags: string[];
  enabled?: boolean;
}

export interface MandateMarshalConfig {
  schemaVersion: 1;
  host: string;
  roles: {
    parent: { mode: "inherit" } | CodexNativeRoleConfig;
    routineImplementer: CodexNativeRoleConfig;
    complexImplementer: CodexNativeRoleConfig;
    freshReviewer: CodexNativeRoleConfig;
  };
  review: {
    mandatory: true;
    freshContextRequired: true;
    requestedReadOnly: boolean;
  };
  evidence: {
    storage: "external-user-data" | "repo-local-ignored" | "ephemeral" | string;
    captureGitState: boolean;
    captureCommands: boolean;
    forbiddenArtifacts: ArtifactRule[];
    commandPolicies: CommandPolicyConfig[];
  };
  ownerContracts: OwnerContract[];
  routing: {
    defaultLane: "routine-implementer";
    complexityTriggers: ComplexityTrigger[];
    allowSilentFallback: false;
  };
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: unknown, hostCapabilities?: HostCapabilities): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(config)) return { valid: false, errors: ["config must be an object"], warnings };
  if (config.schemaVersion !== 1) errors.push("unsupported schemaVersion");
  if (!nonEmpty(config.host)) errors.push("host is required");
  if (!isRecord(config.roles)) errors.push("roles are required");
  else {
    validateNativeRole(config.roles.routineImplementer, "routine-implementer", "roles.routineImplementer", errors);
    validateNativeRole(config.roles.complexImplementer, "complex-implementer", "roles.complexImplementer", errors);
    validateNativeRole(config.roles.freshReviewer, "fresh-reviewer", "roles.freshReviewer", errors);
    if (!isRecord(config.roles.parent)) errors.push("roles.parent is required");
    else if (config.roles.parent.mode !== "inherit") {
      validateNativeRole(config.roles.parent, undefined, "roles.parent", errors);
    }
  }
  if (!isRecord(config.review)) errors.push("review config is required");
  else {
    if (config.review.mandatory !== true) errors.push("compliant v0.1 requires mandatory fresh review");
    if (config.review.freshContextRequired !== true) errors.push("compliant v0.1 requires fresh reviewer context");
    if (config.review.requestedReadOnly !== true) errors.push("compliant v0.1 requires Fresh Reviewer read-only to be requested");
  }
  if (!isRecord(config.evidence)) errors.push("evidence config is required");
  else {
    if (!nonEmpty(config.evidence.storage)) errors.push("evidence.storage is required");
    if (typeof config.evidence.captureGitState !== "boolean") errors.push("evidence.captureGitState must be boolean");
    if (typeof config.evidence.captureCommands !== "boolean") errors.push("evidence.captureCommands must be boolean");
    if (!Array.isArray(config.evidence.forbiddenArtifacts)) errors.push("evidence.forbiddenArtifacts must be an array");
    else {
      for (const [index, rule] of config.evidence.forbiddenArtifacts.entries()) {
        if (!isRecord(rule) || !nonEmpty(rule.id) || !Array.isArray(rule.patterns) || !rule.patterns.every(nonEmpty)) {
          errors.push(`invalid evidence.forbiddenArtifacts[${index}]`);
          continue;
        }
        if (rule.severity !== "blocking" && rule.severity !== "warning") {
          errors.push(`invalid evidence.forbiddenArtifacts[${index}].severity`);
        }
      }
    }
    if (!Array.isArray(config.evidence.commandPolicies)) errors.push("evidence.commandPolicies must be an array");
    else {
      for (const [index, policy] of config.evidence.commandPolicies.entries()) {
        if (!isRecord(policy) || !nonEmpty(policy.id) || !nonEmpty(policy.command) || !Array.isArray(policy.requiredFlags) || !policy.requiredFlags.every(nonEmpty)) {
          errors.push(`invalid evidence.commandPolicies[${index}]`);
        }
      }
    }
  }
  if (!isRecord(config.routing)) errors.push("routing config is required");
  else {
    if (config.routing.defaultLane !== "routine-implementer") errors.push("v0.1 defaultLane must be routine-implementer");
    if (config.routing.allowSilentFallback !== false) errors.push("silent fallback is forbidden");
    if (!Array.isArray(config.routing.complexityTriggers)) errors.push("routing.complexityTriggers must be an array");
    else {
      const known = new Set<string>(COMPLEXITY_TRIGGERS);
      for (const trigger of config.routing.complexityTriggers) {
        if (typeof trigger !== "string" || !known.has(trigger)) errors.push(`unknown complexity trigger: ${String(trigger)}`);
      }
    }
  }

  if (!Array.isArray(config.ownerContracts)) errors.push("ownerContracts must be an array");
  else {
    const ids = new Set<string>();
    for (const item of config.ownerContracts) {
      if (!isRecord(item) || !nonEmpty(item.id)) {
        errors.push("owner contract missing id");
        continue;
      }
      if (item.level !== "owner") errors.push(`owner contract ${item.id} must have level=owner`);
      if (!nonEmpty(item.text)) errors.push(`owner contract ${item.id} missing text`);
      if (item.tags !== undefined && (!Array.isArray(item.tags) || !item.tags.every(nonEmpty))) {
        errors.push(`owner contract ${item.id} tags must be non-empty strings`);
      }
      if (ids.has(item.id)) errors.push(`duplicate owner contract id: ${item.id}`);
      ids.add(item.id);
    }
  }

  if (hostCapabilities) {
    if (!hostCapabilities.freshContext) errors.push("REVIEW_CAPABILITY_UNAVAILABLE");
    if (!hostCapabilities.exactModelSelection) errors.push("EXACT_MODEL_SELECTION_UNAVAILABLE");
    if (!hostCapabilities.reasoningSelection) errors.push("EXACT_EFFORT_SELECTION_UNAVAILABLE");
    if (!hostCapabilities.observedReadOnly && hostCapabilities.requestedReadOnly) {
      warnings.push("reviewer read-only is requested but not observed/enforced by evidence");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateNativeRole(
  value: unknown,
  expectedNativeRole: string | undefined,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} is required`);
    return;
  }
  if (!nonEmpty(value.nativeRole)) errors.push(`${path}.nativeRole is required`);
  else if (expectedNativeRole !== undefined && value.nativeRole !== expectedNativeRole) {
    errors.push(`${path}.nativeRole must equal ${expectedNativeRole}`);
  }
  if (!nonEmpty(value.model)) errors.push(`${path}.model is required`);
  if (!nonEmpty(value.effort)) errors.push(`${path}.effort is required`);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
