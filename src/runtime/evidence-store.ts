import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { EscalationPacket, ExecutionEvidence, ReviewResult, RunEvent } from "../core/types";

export interface RunArtifactBundle {
  run: unknown;
  events: readonly RunEvent[];
  evidence: ExecutionEvidence;
  review?: ReviewResult;
  escalation?: EscalationPacket;
}

export function defaultRunRoot(): string {
  return join(homedir(), ".mandatemarshal", "runs");
}

export async function persistRunArtifacts(
  runId: string,
  bundle: RunArtifactBundle,
  root = defaultRunRoot(),
): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("Unsafe runId");
  const resolvedRoot = resolve(root);
  const dir = resolve(resolvedRoot, runId);
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  // Run artifacts are audit evidence. Never overwrite an existing run ID.
  await mkdir(dir, { mode: 0o700 });

  await Promise.all([
    writeArtifact(join(dir, "run.json"), `${JSON.stringify(bundle.run, null, 2)}\n`),
    writeArtifact(join(dir, "events.jsonl"), `${bundle.events.map((event) => JSON.stringify(event)).join("\n")}\n`),
    writeArtifact(join(dir, "evidence.json"), `${JSON.stringify(bundle.evidence, null, 2)}\n`),
    ...(bundle.review ? [writeArtifact(join(dir, "review.json"), `${JSON.stringify(bundle.review, null, 2)}\n`)] : []),
    ...(bundle.escalation ? [writeArtifact(join(dir, "escalation.json"), `${JSON.stringify(bundle.escalation, null, 2)}\n`)] : []),
  ]);
  return dir;
}

async function writeArtifact(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
}
