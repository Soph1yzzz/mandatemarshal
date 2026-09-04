import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRepositoryCandidateId } from "../../src/runtime/repo-state";

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stderr}`);
}

async function initRepo(root: string): Promise<void> {
  await run(root, ["git", "init"]);
  await run(root, ["git", "config", "user.email", "mandatemarshal-test@example.invalid"]);
  await run(root, ["git", "config", "user.name", "MandateMarshal Test"]);
}

test("candidate identity changes when untracked file contents change under the same path", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-git-candidate-"));
  try {
    await initRepo(root);
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

test("valid untracked names beginning with two dots stay inside the repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-git-dotdot-name-"));
  try {
    await initRepo(root);
    await writeFile(join(root, "tracked.txt"), "base\n", "utf8");
    await run(root, ["git", "add", "tracked.txt"]);
    await run(root, ["git", "commit", "-m", "base"]);
    await writeFile(join(root, "..candidate.txt"), "safe-name\n", "utf8");
    await expect(computeRepositoryCandidateId(root)).resolves.toMatch(/^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test("ignored artifact bytes do not perturb Git candidate identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-git-ignored-candidate-"));
  try {
    await initRepo(root);
    await writeFile(join(root, ".gitignore"), "artifacts/\n", "utf8");
    await writeFile(join(root, "tracked.txt"), "base\n", "utf8");
    await run(root, ["git", "add", ".gitignore", "tracked.txt"]);
    await run(root, ["git", "commit", "-m", "base"]);
    await mkdir(join(root, "artifacts"));
    const artifact = join(root, "artifacts", "large.bin");
    await writeFile(artifact, "artifact-one", "utf8");
    const first = await computeRepositoryCandidateId(root);
    await writeFile(artifact, "artifact-two", "utf8");
    const second = await computeRepositoryCandidateId(root);
    expect(second).toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test("tracked worktree content still changes candidate identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-git-tracked-candidate-"));
  try {
    await initRepo(root);
    const tracked = join(root, "tracked.txt");
    await writeFile(tracked, "base\n", "utf8");
    await run(root, ["git", "add", "tracked.txt"]);
    await run(root, ["git", "commit", "-m", "base"]);
    const first = await computeRepositoryCandidateId(root);
    await writeFile(tracked, "changed\n", "utf8");
    const second = await computeRepositoryCandidateId(root);
    expect(second).not.toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
