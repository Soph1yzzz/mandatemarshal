import { createHash } from "node:crypto";

export function candidateIdFromParts(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(":");
    hash.update(part);
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function candidateIdFromDiff(base: string | undefined, diff: string, evidenceDigest = ""): string {
  return candidateIdFromParts([base ?? "NO_BASE", diff, evidenceDigest]);
}
