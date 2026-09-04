import { createHash } from "node:crypto";
import { lstat, readlink, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

async function gitUntrackedDigest(root: string, paths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const gitPath of [...paths].sort()) {
    const absolute = resolve(root, gitPath);
    const rel = relative(root, absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`GIT_UNTRACKED_PATH_ESCAPE:${gitPath}`);
    }
    const info = await lstat(absolute);
    const normalized = rel.replace(/\\/g, "/");
    if (info.isSymbolicLink()) {
      hash.update(`L:${normalized}:${await readlink(absolute)}\n`);
    } else if (info.isFile()) {
      hash.update(`F:${normalized}:${info.size}:`);
      hash.update(await readFile(absolute));
      hash.update("\n");
    } else {
      hash.update(`O:${normalized}\n`);
    }
  }
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

  const [head, status, untrackedResult] = await Promise.all([
    run(cwd, ["git", "rev-parse", "HEAD"]),
    run(cwd, ["git", "status", "--porcelain=v1", "-uall"]),
    run(cwd, ["git", "ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  if (untrackedResult.code !== 0) throw new Error(`GIT_UNTRACKED_LIST_FAILED:${untrackedResult.stderr.trim()}`);
  const untracked = untrackedResult.stdout.split("\0").filter(Boolean);

  return {
    available: true,
    ...(head.code === 0 ? { baseRevision: head.stdout.trim() } : {}),
    status: lines,
    untracked,
    // Candidate bytes are intentionally limited to Git-relevant untracked files.
    // Tracked mutations are already bound by the HEAD-relative binary diff below.
    // This avoids recursively hashing unchanged tracked files and ignored artifact
    // trees while still changing identity when an untracked file changes in place.
    digest: await gitUntrackedDigest(cwd, untracked),
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
