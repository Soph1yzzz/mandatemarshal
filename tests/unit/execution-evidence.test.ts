import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCommandPolicy } from "../../src/runtime/command-policy";
import { scanArtifacts } from "../../src/runtime/artifact-scan";
import { verifyOwnership } from "../../src/runtime/ownership";

 describe("deterministic execution evidence", () => {
  test("detects missing python -B even when no bytecode artifact is observed", () => {
    const findings = validateCommandPolicy(
      { requiredFlags: [{ command: "python", flag: "-B" }] },
      [{ command: "python verify.py" }],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("MISSING_REQUIRED_FLAG");
    expect(findings[0]?.command).toBe("python verify.py");
  });

  test("accepts required python -B flag", () => {
    const findings = validateCommandPolicy(
      { requiredFlags: [{ command: "python", flag: "-B" }] },
      [{ command: "python -B verify.py" }],
    );
    expect(findings).toEqual([]);
  });

  test("detects forbidden command", () => {
    const findings = validateCommandPolicy(
      { forbiddenCommands: ["rm -rf"] },
      [{ command: "rm -rf build" }],
    );
    expect(findings[0]?.code).toBe("FORBIDDEN_COMMAND");
  });

  test("path ownership rejects unrelated edits", () => {
    const result = verifyOwnership(["src/a.ts", "README.md"], ["src/**"]);
    expect(result.passed).toBeFalse();
    expect(result.violations).toEqual(["README.md"]);
  });

  test("artifact scanner catches actual forbidden Python bytecode", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-artifacts-"));
    try {
      const cache = join(root, "pkg", "__pycache__");
      await mkdir(cache, { recursive: true });
      await writeFile(join(cache, "module.cpython-313.pyc"), "fixture", "utf8");
      const result = await scanArtifacts(root, [{
        id: "python-bytecode-forbidden",
        patterns: ["**/__pycache__/**", "**/*.pyc"],
        severity: "blocking",
      }]);
      expect(result[0]?.passed).toBeFalse();
      expect(result[0]?.matchedPaths.some((path) => path.endsWith(".pyc"))).toBeTrue();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
