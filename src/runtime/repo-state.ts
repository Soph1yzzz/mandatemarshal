import { createHash } from "node:crypto";
import { readlink, readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { candidateIdFromParts } from "../core/candidate";
import type { RepositoryState } from "../core/types";

async function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function fileDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = resolve(dir, entry.name);
      const rel = relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        hash.update(`D:${rel}\n`);
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        hash.update(`F:${rel}:${info.size}:`);
        hash.update(await readFile(absolute));
        hash.update("\n");
      } else if (entry.isSymbolicLink()) {
        hash.update(`L:${rel}:${await readlink(absolute)}\n`);
      } else {
        hash.update(`O:${rel}\n`);
      }
    }
  }
  await walk(root);
  return hash.digest("hex");
}

export async function captureRepositoryState(root: string): Promise<RepositoryState> {
  const cwd = resolve(root);
  const inside = await run(cwd, ["git", "rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return {
      available: false,
      digest: await fileDigest(cwd),
    };
  }

  const [head, status] = await Promise.all([
    run(cwd, ["git", "rev-parse", "HEAD"]),
    run(cwd, ["git", "status", "--porcelain=v1", "-uall"]),
  ]);
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith("?? ")).map((line) => line.slice(3));

  return {
    available: true,
    ...(head.code === 0 ? { baseRevision: head.stdout.trim() } : {}),
    status: lines,
    untracked,
    // Include worktree bytes, not only porcelain status. In particular, Git's
    // normal diff does not contain untracked-file contents; candidate identity
    // must still change when an untracked file changes under the same pathname.
    digest: await fileDigest(cwd),
  };
}

export async function captureGitDiff(root: string): Promise<string> {
  const cwd = resolve(root);
  const result = await run(cwd, ["git", "diff", "--no-ext-diff", "--binary", "HEAD"]);
  return result.code === 0 ? result.stdout : "";
}

export interface RepositoryCandidateObservation {
  candidateId: string;
  state: RepositoryState;
}

export async function observeRepositoryCandidate(root: string): Promise<RepositoryCandidateObservation> {
  const state = await captureRepositoryState(root);
  if (!state.available) {
    return {
      candidateId: candidateIdFromParts(["non-git", state.digest ?? "NO_DIGEST"]),
      state,
    };
  }
  const diff = await captureGitDiff(root);
  return {
    candidateId: candidateIdFromParts([
      "git",
      state.baseRevision ?? "NO_BASE",
      state.status?.join("\n") ?? "",
      state.digest ?? "NO_DIGEST",
      diff,
    ]),
    state,
  };
}

export async function computeRepositoryCandidateId(root: string): Promise<string> {
  return (await observeRepositoryCandidate(root)).candidateId;
}
