import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";

export interface ProjectActivationRecord {
  schemaVersion: 1;
  projectId: string;
  projectPath: string;
  projectName: string;
  enabled: boolean;
  activationSource: "explicit-user";
  activatedAt: string;
  updatedAt: string;
  disabledAt?: string;
}

export interface ProjectActivationOptions {
  storageRoot?: string;
  now?: () => Date;
}

export interface ProjectActivationDecision {
  enabled: boolean;
  reason: "explicit-invocation" | "project-activation" | "not-activated";
  record?: ProjectActivationRecord;
}

export async function canonicalProjectPath(projectPath: string): Promise<string> {
  const absolute = resolve(projectPath);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    canonical = absolute;
  }
  const normalized = canonical.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function projectActivationId(projectPath: string): Promise<string> {
  const canonical = await canonicalProjectPath(projectPath);
  return createHash("sha256").update(`mandatemarshal-project-v1\0${canonical}`).digest("hex");
}

export function defaultMandateMarshalHome(): string {
  return process.env.MANDATEMARSHAL_HOME
    ? resolve(process.env.MANDATEMARSHAL_HOME)
    : join(homedir(), ".mandatemarshal");
}

export async function readProjectActivation(
  projectPath: string,
  options: ProjectActivationOptions = {},
): Promise<ProjectActivationRecord | undefined> {
  const location = await activationFile(projectPath, options.storageRoot);
  try {
    const parsed: unknown = JSON.parse(await readFile(location.file, "utf8"));
    return validateRecord(parsed, location.projectId, location.projectPath);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export async function enableProjectActivation(
  projectPath: string,
  options: ProjectActivationOptions = {},
): Promise<ProjectActivationRecord> {
  await assertExistingProjectDirectory(projectPath);
  const location = await activationFile(projectPath, options.storageRoot);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const previous = await readProjectActivation(projectPath, options);
  const record: ProjectActivationRecord = {
    schemaVersion: 1,
    projectId: location.projectId,
    projectPath: location.projectPath,
    projectName: basename(location.projectPath),
    enabled: true,
    activationSource: "explicit-user",
    activatedAt: previous?.activatedAt ?? now,
    updatedAt: now,
  };
  await persistRecord(location.file, record);
  return record;
}

export async function disableProjectActivation(
  projectPath: string,
  options: ProjectActivationOptions = {},
): Promise<ProjectActivationRecord> {
  const location = await activationFile(projectPath, options.storageRoot);
  const now = (options.now ?? (() => new Date()))().toISOString();
  const previous = await readProjectActivation(projectPath, options);
  const record: ProjectActivationRecord = {
    schemaVersion: 1,
    projectId: location.projectId,
    projectPath: location.projectPath,
    projectName: basename(location.projectPath),
    enabled: false,
    activationSource: "explicit-user",
    activatedAt: previous?.activatedAt ?? now,
    updatedAt: now,
    disabledAt: now,
  };
  await persistRecord(location.file, record);
  return record;
}

export async function resolveProjectActivation(
  projectPath: string,
  explicitInvocation: boolean,
  options: ProjectActivationOptions = {},
): Promise<ProjectActivationDecision> {
  if (explicitInvocation) {
    const record = await enableProjectActivation(projectPath, options);
    return { enabled: true, reason: "explicit-invocation", record };
  }
  const record = await readProjectActivation(projectPath, options);
  if (record?.enabled) return { enabled: true, reason: "project-activation", record };
  return { enabled: false, reason: "not-activated", ...(record === undefined ? {} : { record }) };
}

async function activationFile(projectPath: string, storageRoot?: string): Promise<{
  file: string;
  projectId: string;
  projectPath: string;
}> {
  const canonical = await canonicalProjectPath(projectPath);
  const projectId = createHash("sha256").update(`mandatemarshal-project-v1\0${canonical}`).digest("hex");
  const root = storageRoot ? resolve(storageRoot) : defaultMandateMarshalHome();
  return {
    file: join(root, "projects", `${projectId}.json`),
    projectId,
    projectPath: canonical,
  };
}

async function persistRecord(file: string, record: ProjectActivationRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function validateRecord(value: unknown, expectedId: string, expectedPath: string): ProjectActivationRecord {
  if (!isRecord(value)) throw new Error("Invalid MandateMarshal project activation record: expected object");
  if (value.schemaVersion !== 1) throw new Error("Invalid MandateMarshal project activation record: schemaVersion");
  if (value.projectId !== expectedId) throw new Error("Invalid MandateMarshal project activation record: projectId mismatch");
  if (value.projectPath !== expectedPath) throw new Error("Invalid MandateMarshal project activation record: projectPath mismatch");
  if (typeof value.projectName !== "string") throw new Error("Invalid MandateMarshal project activation record: projectName");
  if (typeof value.enabled !== "boolean") throw new Error("Invalid MandateMarshal project activation record: enabled");
  if (value.activationSource !== "explicit-user") throw new Error("Invalid MandateMarshal project activation record: activationSource");
  if (typeof value.activatedAt !== "string" || typeof value.updatedAt !== "string") {
    throw new Error("Invalid MandateMarshal project activation record: timestamps");
  }
  if (value.disabledAt !== undefined && typeof value.disabledAt !== "string") {
    throw new Error("Invalid MandateMarshal project activation record: disabledAt");
  }
  return value as unknown as ProjectActivationRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertExistingProjectDirectory(projectPath: string): Promise<void> {
  const absolute = resolve(projectPath);
  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    if (isMissingFile(error)) throw new Error(`Cannot activate missing project directory: ${absolute}`);
    throw error;
  }
  if (!info.isDirectory()) throw new Error(`Cannot activate non-directory project path: ${absolute}`);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
