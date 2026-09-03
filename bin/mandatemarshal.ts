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
  captureRunCandidate,
  ensureRunReceipt,
  listRunReceipts,
  readRunHistory,
  readRunReceipt,
  recordRunReceiptEvent,
  startRunReceipt,
  type RunReceiptEventInput,
  type RunReceiptEventType,
} from "../src/runtime/run-receipt";
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
  await handleRun(action, targetArg, args[3]);
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
  const displayStatus = info.pinStatus === "unpinned" ? "UNPINNED" : info.aligned ? "OK" : "DRIFTED";
  console.log(
    [
      `MandateMarshal ${info.version}`,
      `Pin: ${info.pinnedVersion === null ? "none" : `v${info.pinnedVersion}`}`,
      `Plugin: ${info.installedPluginVersion ?? "not installed"}`,
      `Cache: ${info.pluginCacheVersion ?? "not installed"}`,
      `Skill: ${info.pluginCacheSkillVersion ?? "not installed"}`,
      `Legacy Skill: ${info.legacySkillVersion ?? "none"}`,
      `Status: ${displayStatus}`,
    ].join("\n"),
  );
  if (info.pinStatus === "drifted") process.exitCode = 4;
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

async function handleRun(action: string | undefined, targetArg: string | undefined, eventArg: string | undefined): Promise<void> {
  const receiptRootFlag = readFlagValue("--receipt-root");
  const traceRootFlag = readFlagValue("--trace-root");
  const receiptOptions = {
    ...(receiptRootFlag === undefined ? {} : { storageRoot: resolve(receiptRootFlag) }),
    ...(traceRootFlag === undefined ? {} : { traceRoot: resolve(traceRootFlag) }),
  };

  switch (action) {
    case "start":
    case "ensure": {
      const projectPath = targetArg && !targetArg.startsWith("--") ? targetArg : process.cwd();
      if (readFlagValue("--mode") !== undefined) throw new Error("RUN_RECEIPT_MODE_OVERRIDE_UNAVAILABLE");
      if (action === "ensure") {
        console.log(JSON.stringify(await ensureRunReceipt(projectPath, "skill-contract", receiptOptions), null, 2));
      } else {
        console.log(JSON.stringify(await startRunReceipt(projectPath, "skill-contract", receiptOptions), null, 2));
      }
      return;
    }
    case "list": {
      console.log(JSON.stringify({ schemaVersion: 1, runs: await listRunReceipts(receiptOptions) }, null, 2));
      return;
    }
    case "show": {
      requireRunId(targetArg);
      console.log(JSON.stringify(await readRunReceipt(targetArg, receiptOptions), null, 2));
      return;
    }
    case "history": {
      requireRunId(targetArg);
      console.log(JSON.stringify(await readRunHistory(targetArg, receiptOptions), null, 2));
      return;
    }
    case "capture": {
      requireRunId(targetArg);
      console.log(JSON.stringify(await captureRunCandidate(targetArg, receiptOptions), null, 2));
      return;
    }
    case "record": {
      requireRunId(targetArg);
      const event = parseRunReceiptEvent(eventArg);
      const candidate = readFlagValue("--candidate");
      const thread = readFlagValue("--thread");
      const verdict = readFlagValue("--verdict");
      const input: RunReceiptEventInput = {
        ...(candidate === undefined ? {} : { candidateId: candidate }),
        ...(thread === undefined ? {} : { threadId: thread }),
        ...(verdict === undefined ? {} : { verdict: parseVerdict(verdict) }),
      };
      console.log(JSON.stringify(await recordRunReceiptEvent(targetArg, event, input, receiptOptions), null, 2));
      return;
    }
    case "status":
    case "resume": {
      requireRunId(targetArg);
      const root = resolve(readFlagValue("--root") ?? defaultDurableRunRoot());
      if (action === "status") {
        const status = await inspectDurableRun(targetArg, root);
        console.log(JSON.stringify(status, null, 2));
        process.exitCode = status.resumeStatus === "reconciliation-required" ? 4 : 0;
        return;
      }
      const status = await recordResumeRequest(targetArg, root);
      console.log(JSON.stringify(status, null, 2));
      process.exitCode = status.resumeStatus === "ready" ? 0 : status.resumeStatus === "terminal" ? 3 : 4;
      return;
    }
    default:
      printUsage();
      process.exitCode = 2;
  }
}

function requireRunId(runId: string | undefined): asserts runId is string {
  if (!runId?.trim()) {
    printUsage();
    throw new Error("RUN_ID_REQUIRED");
  }
}

function parseRunReceiptEvent(value: string | undefined): Exclude<RunReceiptEventType, "run-started"> {
  if (
    value === "implementer-started" ||
    value === "parent-verified" ||
    value === "reviewer-started" ||
    value === "review-verdict" ||
    value === "correction-started" ||
    value === "run-completed" ||
    value === "run-aborted"
  ) {
    return value;
  }
  throw new Error(`RUN_RECEIPT_EVENT_INVALID:${value ?? "missing"}`);
}

function parseVerdict(value: string): "PASS" | "FIX" | "ESCALATE" {
  if (value === "PASS" || value === "FIX" || value === "ESCALATE") return value;
  throw new Error(`RUN_RECEIPT_VERDICT_INVALID:${value}`);
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
      "  mandatemarshal run <start|ensure> [project-path]",
      "  mandatemarshal run list",
      "  mandatemarshal run <show|history|capture> <run-id>",
      "  mandatemarshal run record <run-id> <event> [--candidate <id>] [--thread <id>] [--verdict PASS|FIX|ESCALATE]",
      "  mandatemarshal run <status|resume> <run-id> [--root <runtime-root>]",
      "  mandatemarshal pin [status|latest|<version>]",

    ].join("\n"),
  );
}
