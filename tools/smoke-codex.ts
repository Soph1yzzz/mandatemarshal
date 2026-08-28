import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCliDriver } from "../src/adapters/codex/cli-driver";
import { DEFAULT_CODEX_ROLE_MAPPING } from "../src/adapters/codex/role-mapping";
import type { ImplementationPacket, ReviewerSpawnRequest } from "../src/core/types";

const root = await mkdtemp(join(tmpdir(), "mandatemarshal-real-smoke-"));

function packet(lane: "routine-implementer" | "complex-implementer"): ImplementationPacket {
  return {
    schemaVersion: 1,
    routing: {
      lane,
      reason: "MandateMarshal real-host smoke test",
      requestedModel:
        lane === "routine-implementer"
          ? DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.model
          : DEFAULT_CODEX_ROLE_MAPPING.complexImplementer.model,
      requestedEffort:
        lane === "routine-implementer"
          ? DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.effort
          : DEFAULT_CODEX_ROLE_MAPPING.complexImplementer.effort,
    },
    objective: {
      outcome: "Read SMOKE.md. If it contains the exact marker MANDATEMARSHAL_SMOKE_OK, return a complete implementation report without changing any file.",
      why: "Release-gate smoke test of exact lane execution and bounded read-only task completion.",
    },
    ownership: { allowedPaths: ["SMOKE.md"] },
    interfaces: [],
    constraints: [
      "Do not create, edit, or delete files.",
      "Read SMOKE.md and verify the exact marker.",
      "This is a smoke test; the task is complete when the marker is observed and no file changes are made.",
    ],
    executionContract: {
      allowedWritePaths: [],
    },
    verification: [
      {
        kind: "inspect",
        target: "SMOKE.md",
        success: "The file contains MANDATEMARSHAL_SMOKE_OK and remains unchanged.",
      },
    ],
    returnContract: "ImplementationReport v1 JSON",
  };
}

const reviewerRequest: ReviewerSpawnRequest = {
  candidateId: "mandatemarshal-smoke-candidate",
  objective: "Confirm SMOKE.md contains MANDATEMARSHAL_SMOKE_OK, the candidate requires no changes, and the supplied no-mutation evidence is sufficient.",
  interfaces: [],
  constraints: ["Remain read-only.", "Do not edit files.", "The marker MANDATEMARSHAL_SMOKE_OK is the complete acceptance criterion."],
  allowedPaths: ["SMOKE.md"],
  evidence: {
    commands: [],
    verificationChecks: [
      {
        target: "SMOKE.md",
        passed: true,
        detail: "Parent observed MANDATEMARSHAL_SMOKE_OK and no workspace mutation after both implementer smoke runs.",
        trust: "OBSERVED",
      },
    ],
  },
};

try {
  const smokePath = join(root, "SMOKE.md");
  await writeFile(smokePath, "# MandateMarshal real-host smoke\n\nMANDATEMARSHAL_SMOKE_OK\n", "utf8");
  const beforeContent = await readFile(smokePath, "utf8");
  const beforeEntries = (await readdir(root)).sort();
  const driver = new CodexCliDriver({ cwd: root });

  const routine = await driver.runImplementer({
    role: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer,
    request: { packet: packet("routine-implementer") },
  });

  const complex = await driver.runImplementer({
    role: DEFAULT_CODEX_ROLE_MAPPING.complexImplementer,
    request: { packet: packet("complex-implementer") },
  });

  const afterImplementerContent = await readFile(smokePath, "utf8");
  const afterImplementerEntries = (await readdir(root)).sort();
  if (afterImplementerContent !== beforeContent || JSON.stringify(afterImplementerEntries) !== JSON.stringify(beforeEntries)) {
    throw new Error("REAL_SMOKE_MUTATION: implementer smoke changed the temporary workspace");
  }
  if (routine.result.status !== "complete" || complex.result.status !== "complete") {
    throw new Error(
      `REAL_SMOKE_IMPLEMENTER_NOT_COMPLETE routine=${routine.result.status}:${routine.result.gaps.join(" | ")} complex=${complex.result.status}:${complex.result.gaps.join(" | ")}`,
    );
  }

  const reviewer = await driver.runReviewer({
    role: DEFAULT_CODEX_ROLE_MAPPING.freshReviewer,
    request: reviewerRequest,
    readOnly: true,
    fresh: true,
  });

  const afterReviewerContent = await readFile(smokePath, "utf8");
  const afterReviewerEntries = (await readdir(root)).sort();
  if (afterReviewerContent !== beforeContent || JSON.stringify(afterReviewerEntries) !== JSON.stringify(beforeEntries)) {
    throw new Error("REAL_SMOKE_MUTATION: fresh reviewer changed the temporary workspace");
  }
  if (reviewer.result.verdict !== "PASS") {
    throw new Error(`REAL_SMOKE_REVIEW_NOT_PASS verdict=${reviewer.result.verdict}; reason=${reviewer.result.reason}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        tempWorkspace: root,
        routine: {
          requestedModel: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.model,
          requestedEffort: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.effort,
          reportStatus: routine.result.status,
        },
        complex: {
          requestedModel: DEFAULT_CODEX_ROLE_MAPPING.complexImplementer.model,
          requestedEffort: DEFAULT_CODEX_ROLE_MAPPING.complexImplementer.effort,
          reportStatus: complex.result.status,
        },
        reviewer: {
          requestedModel: DEFAULT_CODEX_ROLE_MAPPING.freshReviewer.model,
          requestedEffort: DEFAULT_CODEX_ROLE_MAPPING.freshReviewer.effort,
          verdict: reviewer.result.verdict,
          candidateId: reviewer.result.candidateId,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
