import { resolve } from "node:path";
import {
  disableProjectActivation,
  enableProjectActivation,
  readProjectActivation,
  resolveProjectActivation,
} from "../src/runtime/project-activation";

const [command = "status", target = process.cwd()] = process.argv.slice(2);
const projectPath = resolve(target);

switch (command) {
  case "enable": {
    const record = await enableProjectActivation(projectPath);
    console.log(JSON.stringify({ status: "enabled", record }, null, 2));
    break;
  }
  case "disable": {
    const record = await disableProjectActivation(projectPath);
    console.log(JSON.stringify({ status: "disabled", record }, null, 2));
    break;
  }
  case "status": {
    const record = await readProjectActivation(projectPath);
    console.log(JSON.stringify({ status: record?.enabled ? "enabled" : "disabled", record: record ?? null }, null, 2));
    break;
  }
  case "resolve": {
    const explicit = process.argv.includes("--explicit");
    const decision = await resolveProjectActivation(projectPath, explicit);
    console.log(JSON.stringify(decision, null, 2));
    process.exitCode = decision.enabled ? 0 : 3;
    break;
  }
  default:
    console.error("Usage: bun tools/activation.ts <status|enable|disable|resolve> [project-path] [--explicit]");
    process.exitCode = 2;
}
