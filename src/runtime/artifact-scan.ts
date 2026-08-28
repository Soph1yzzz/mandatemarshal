import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ArtifactRule, ArtifactScanEvidence } from "../core/types";

function globToRegex(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if ("\\.^$+{}()|[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`, "i");
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute).replace(/\\/g, "/");
    paths.push(rel + (entry.isDirectory() ? "/" : ""));
    if (entry.isDirectory()) paths.push(...await walk(root, absolute));
  }
  return paths;
}

export async function scanArtifacts(root: string, rules: readonly ArtifactRule[]): Promise<ArtifactScanEvidence[]> {
  const allPaths = await walk(resolve(root));
  return rules
    .filter((rule) => rule.enabled !== false)
    .map((rule) => {
      const regexes = rule.patterns.map(globToRegex);
      const matchedPaths = allPaths.filter((path) => regexes.some((regex) => regex.test(path)));
      return {
        ruleId: rule.id,
        matchedPaths,
        passed: rule.severity === "warning" || matchedPaths.length === 0,
        trust: "OBSERVED" as const,
      };
    });
}

export function pathMatchesGlob(path: string, glob: string): boolean {
  return globToRegex(glob).test(path.replace(/\\/g, "/"));
}
