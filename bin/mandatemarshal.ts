#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  disableProjectActivation,
  enableProjectActivation,
  readProjectActivation,
  resolveProjectActivation,
} from "../src/runtime/project-activation";
import { defaultDurableRunRoot } from "../src/runtime/durable-run-store";
import { inspectDurableRun, recordResumeRequest } from "../src/runtime/durable-status";
import {
  inspectMandateMarshalPin,
  inspectMandateMarshalVersion,
  maybeDelegateToPinnedCli,
  readMandateMarshalPackageVersion,
  pinMandateMarshal,
} from "../src/runtime/version-pin";

const args = process.argv.slice(2);
const delegatedExit = await maybeDelegateToPinnedCli(args);
if (delegatedExit !== undefined) process.exit(delegatedExit);

const [group, action, targetArg] = args;

if (group === "version" || group === "--version" || group === "-v") {
  await handleVersion(group !== "version");
} else if (group === "activation") {
  await handleActivation(action, targetArg);
} else if (group === "run") {
  await handleRun(action, targetArg);
} else if (group === "pin") {
  await handlePin(action);
} else {
  printUsage();
  process.exitCode = 2;
}

async function handleVersion(compact: boolean): Promise<void> {
  if (compact) {
    console.log(await readMandateMarshalPackageVersion());
    return;
  }
  const info = await inspectMandateMarshalVersion();
  console.log(
    [
      `MandateMarshal ${info.version}`,
      `Pin: ${info.pinnedVersion === null ? "none" : `v${info.pinnedVersion}`}`,
      `Plugin: ${info.installedPluginVersion ?? "not installed"}`,
      `Skill: ${info.legacySkillVersion ?? "not installed"}`,
      `Status: ${info.aligned ? "OK" : info.pinStatus.toUpperCase()}`,
    ].join("\n"),
  );
  if (!info.aligned) process.exitCode = 4;
}

async function handleActivation(action: string | undefined, targetArg: string | undefined): Promise<void> {
  const target = resolve(targetArg ?? process.cwd());
  switch (action ?? "status") {
    case "enable": {
      const record = await enableProjectActivation(target);
      console.log(JSON.stringify({ status: "enabled", record }, null, 2));
      return;
    }
    case "disable": {
      const record = await disableProjectActivation(target);
      console.log(JSON.stringify({ status: "disabled", record }, null, 2));
      return;
    }
    case "status": {
      const record = await readProjectActivation(target);
      console.log(JSON.stringify({ status: record?.enabled ? "enabled" : "disabled", record: record ?? null }, null, 2));
      return;
    }
    case "resolve": {
      const explicit = process.argv.includes("--explicit");
      const decision = await resolveProjectActivation(target, explicit);
      console.log(JSON.stringify(decision, null, 2));
      process.exitCode = decision.enabled ? 0 : 3;
      return;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

async function handleRun(action: string | undefined, runId: string | undefined): Promise<void> {
  if (!runId?.trim()) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  const root = resolve(readFlagValue("--root") ?? defaultDurableRunRoot());
  switch (action) {
    case "status": {
      const status = await inspectDurableRun(runId, root);
      console.log(JSON.stringify(status, null, 2));
      process.exitCode = status.resumeStatus === "reconciliation-required" ? 4 : 0;
      return;
    }
    case "resume": {
      const status = await recordResumeRequest(runId, root);
      console.log(JSON.stringify(status, null, 2));
      process.exitCode = status.resumeStatus === "ready" ? 0 : status.resumeStatus === "terminal" ? 3 : 4;
      return;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

async function handlePin(action: string | undefined): Promise<void> {
  if (action === undefined || action === "status") {
    console.log(JSON.stringify(await inspectMandateMarshalPin(), null, 2));
    return;
  }
  const record = await pinMandateMarshal(action);
  console.log(
    JSON.stringify(
      {
        status: "pinned",
        record,
        note: "Start a new Codex session so the pinned plugin/Skill metadata is loaded.",
      },
      null,
      2,
    ),
  );
}

function readFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function printUsage(): void {
  console.error(
    [
      "Usage:",
      "  mandatemarshal version | --version | -v",
      "  mandatemarshal activation <status|enable|disable|resolve> [project-path] [--explicit]",
      "  mandatemarshal run <status|resume> <run-id> [--root <runtime-root>]",
      "  mandatemarshal pin [status|latest|<version>]",
    ].join("\n"),
  );
}
