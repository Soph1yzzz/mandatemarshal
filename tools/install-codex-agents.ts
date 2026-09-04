import { access, copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, resolve } from "node:path";

const force = process.argv.includes("--force");
const positional = process.argv.slice(2).filter((arg) => arg !== "--force");
const target = resolve(positional[0] ?? ".codex/agents");
const templateDir = resolve(import.meta.dir, "../templates/codex-agents");
const files = [
  "mandatemarshal_routine_implementer.toml",
  "mandatemarshal_complex_implementer.toml",
  "mandatemarshal_fresh_reviewer.toml",
  "mandatemarshal_fresh_reviewer_astra.toml",
  "mandatemarshal_fresh_reviewer_sol_compat.toml",
];

await mkdir(target, { recursive: true });
for (const file of files) {
  const source = resolve(templateDir, file);
  const destination = resolve(target, basename(file));
  if (!force && await exists(destination)) {
    throw new Error(`Refusing to overwrite existing agent: ${destination}. Re-run with --force only after reviewing the diff.`);
  }
  await copyFile(source, destination);
  console.log(`installed ${destination}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
