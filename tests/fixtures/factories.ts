import type {
  ExecutionEvidence,
  ImplementationPacket,
  ImplementationReport,
  ReviewResult,
} from "../../src/core/types";

export function packet(lane: "routine-implementer" | "complex-implementer" = "routine-implementer"): ImplementationPacket {
  return {
    schemaVersion: 1,
    routing: { lane, reason: "test route" },
    objective: { outcome: "Implement the bounded test objective" },
    ownership: { allowedPaths: ["src/**", "tests/**"] },
    interfaces: ["public behavior remains stable"],
    constraints: ["do not change owner policy"],
    executionContract: {},
    verification: [{ kind: "command", target: "bun test", success: "exit 0" }],
    returnContract: "ImplementationReport v1 JSON",
  };
}

export function implementation(candidateId: string, lane: "routine-implementer" | "complex-implementer" = "routine-implementer"): ImplementationReport {
  return {
    status: "complete",
    routing: { lane, reason: "test route" },
    objective: "Implement the bounded test objective",
    changes: ["src/example.ts"],
    commands: ["bun test"],
    verified: ["tests pass"],
    judgmentCalls: [],
    gaps: [],
    authorityConcerns: [],
    candidateId,
  };
}

export function evidence(): ExecutionEvidence {
  return {
    commands: [{ command: "bun test", cwd: ".", exitCode: 0, source: "parent", trust: "OBSERVED" }],
    verificationChecks: [{ target: "bun test", passed: true, detail: "exit 0", trust: "OBSERVED" }],
  };
}

export function review(verdict: "PASS" | "FIX" | "ESCALATE", candidateId: string): ReviewResult {
  return {
    schemaVersion: 1,
    verdict,
    candidateId,
    reason: verdict === "PASS" ? "No blocking defect" : `${verdict} test finding`,
    findings: verdict === "PASS" ? [] : [{ severity: "blocking", reference: "test", message: "bounded test finding" }],
    requiredAction: verdict === "PASS" ? "" : "resolve test finding",
    residualRisk: "none",
  };
}
