import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRepositoryCandidateId } from "../../src/runtime/repo-state";

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stderr}`);
}

test("candidate identity changes when untracked file contents change under the same path", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-git-candidate-"));
  try {
    await run(root, ["git", "init"]);
    await run(root, ["git", "config", "user.email", "mandatemarshal-test@example.invalid"]);
    await run(root, ["git", "config", "user.name", "MandateMarshal Test"]);
    await writeFile(join(root, "tracked.txt"), "base\n", "utf8");
    await run(root, ["git", "add", "tracked.txt"]);
    await run(root, ["git", "commit", "-m", "base"]);

    const untracked = join(root, "candidate.txt");
    await writeFile(untracked, "version-one\n", "utf8");
    const first = await computeRepositoryCandidateId(root);

    await writeFile(untracked, "version-two\n", "utf8");
    const second = await computeRepositoryCandidateId(root);

    expect(second).not.toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
