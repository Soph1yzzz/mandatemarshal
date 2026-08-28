import { resolve } from "node:path";
import { captureGitDiff, captureRepositoryState } from "../src/runtime/repo-state";

const root = resolve(process.argv[2] ?? ".");
const state = await captureRepositoryState(root);
const diff = state.available ? await captureGitDiff(root) : "";
console.log(JSON.stringify({ schemaVersion: 1, root, state, diff }, null, 2));
