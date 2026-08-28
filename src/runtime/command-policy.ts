import type { CommandEvidence, ExecutionContract } from "../core/types";

export interface CommandPolicyFinding {
  severity: "blocking";
  code: "FORBIDDEN_COMMAND" | "MISSING_REQUIRED_FLAG" | "REQUIRED_COMMAND_MISSING";
  command?: string;
  detail: string;
}

function tokenize(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];
}

function commandFamily(command: string): string {
  return tokenize(command)[0]?.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

function patternMatches(command: string, pattern: string): boolean {
  if (pattern.startsWith("re:")) return new RegExp(pattern.slice(3), "i").test(command);
  return command.toLowerCase().includes(pattern.toLowerCase());
}

export function validateCommandPolicy(
  contract: ExecutionContract,
  evidence: readonly Pick<CommandEvidence, "command">[],
): CommandPolicyFinding[] {
  const findings: CommandPolicyFinding[] = [];
  const commands = evidence.map((item) => item.command);

  for (const required of contract.requiredCommands ?? []) {
    if (!commands.some((command) => patternMatches(command, required.command))) {
      findings.push({
        severity: "blocking",
        code: "REQUIRED_COMMAND_MISSING",
        detail: `Required command was not observed: ${required.command}`,
      });
    }
  }

  for (const command of commands) {
    for (const forbidden of contract.forbiddenCommands ?? []) {
      if (patternMatches(command, forbidden)) {
        findings.push({
          severity: "blocking",
          code: "FORBIDDEN_COMMAND",
          command,
          detail: `Forbidden command matched policy: ${forbidden}`,
        });
      }
    }

    const family = commandFamily(command);
    const tokens = tokenize(command);
    for (const requirement of contract.requiredFlags ?? []) {
      const expectedFamily = requirement.command.toLowerCase();
      if (family === expectedFamily || family === `${expectedFamily}.exe`) {
        if (!tokens.includes(requirement.flag)) {
          findings.push({
            severity: "blocking",
            code: "MISSING_REQUIRED_FLAG",
            command,
            detail: `Required flag missing for ${requirement.command}: ${requirement.flag}`,
          });
        }
      }
    }
  }

  return findings;
}
