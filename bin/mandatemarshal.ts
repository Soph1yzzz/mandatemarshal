#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  disableProjectActivation,
  enableProjectActivation,
  readProjectActivation,
  resolveProjectActivation,
} from "../src/runtime/project-activation";

const [group, action, targetArg] = process.argv.slice(2);

if (group !== "activation") {
  printUsage();
  process.exitCode = 2;
} else {
  const target = resolve(targetArg ?? process.cwd());
  switch (action ?? "status") {
    case "enable": {
      const record = await enableProjectActivation(target);
      console.log(JSON.stringify({ status: "enabled", record }, null, 2));
      break;
    }
    case "disable": {
      const record = await disableProjectActivation(target);
      console.log(JSON.stringify({ status: "disabled", record }, null, 2));
      break;
    }
    case "status": {
      const record = await readProjectActivation(target);
      console.log(JSON.stringify({ status: record?.enabled ? "enabled" : "disabled", record: record ?? null }, null, 2));
      break;
    }
    case "resolve": {
      const explicit = process.argv.includes("--explicit");
      const decision = await resolveProjectActivation(target, explicit);
      console.log(JSON.stringify(decision, null, 2));
      process.exitCode = decision.enabled ? 0 : 3;
      break;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

function printUsage(): void {
  console.error("Usage: mandatemarshal activation <status|enable|disable|resolve> [project-path] [--explicit]");
}
