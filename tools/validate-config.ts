import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateConfig } from "../src/config";

const path = resolve(process.argv[2] ?? "config.example.json");
const config = JSON.parse(await readFile(path, "utf8")) as unknown;
const result = validateConfig(config);
console.log(JSON.stringify({ path, ...result }, null, 2));
if (!result.valid) process.exitCode = 1;
