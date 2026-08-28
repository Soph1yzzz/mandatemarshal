import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MandateMarshalConfig } from "../src/config";
import { scanArtifacts } from "../src/runtime/artifact-scan";

const root = resolve(process.argv[2] ?? ".");
const configPath = resolve(process.argv[3] ?? "config.example.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as MandateMarshalConfig;
const result = await scanArtifacts(root, config.evidence.forbiddenArtifacts);
console.log(JSON.stringify({ schemaVersion: 1, root, result }, null, 2));
if (result.some((item) => !item.passed)) process.exitCode = 1;
