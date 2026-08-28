import type { OwnershipEvidence } from "../core/types";
import { pathMatchesGlob } from "./artifact-scan";

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => path === pattern || path.startsWith(`${pattern.replace(/\/$/, "")}/`) || pathMatchesGlob(path, pattern));
}

export function verifyOwnership(
  touchedPaths: readonly string[],
  allowedWritePaths: readonly string[],
  forbiddenWritePaths: readonly string[] = [],
): OwnershipEvidence {
  const normalized = touchedPaths.map((path) => path.replace(/\\/g, "/"));
  const violations = normalized.filter((path) =>
    !matchesAny(path, allowedWritePaths) || matchesAny(path, forbiddenWritePaths),
  );

  return {
    passed: violations.length === 0,
    touchedPaths: normalized,
    violations,
    trust: "OBSERVED",
  };
}
