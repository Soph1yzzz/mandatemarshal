import { copyFile, cp, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const REPOSITORY = "Soph1yzzz/mandatemarshal";
const MARKETPLACE = "mandatemarshal";
const PLUGIN_SELECTOR = "mandatemarshal@mandatemarshal";
const PIN_STATE_SCHEMA = 1 as const;
const PIN_EXEC_GUARD = "MANDATEMARSHAL_PINNED_EXEC";

export interface MandateMarshalPinRecord {
  schemaVersion: 1;
  version: string;
  ref: string;
  repository: string;
  marketplace: string;
  pluginSource: string;
  runtimeSource: string;
  pinnedAt: string;
}

export interface MandateMarshalPinStatus {
  status: "pinned" | "unpinned" | "drifted";
  record: MandateMarshalPinRecord | null;
  installedPluginVersion: string | null;
  legacySkillVersion: string | null;
}

export interface MandateMarshalVersionInfo {
  version: string;
  pinStatus: MandateMarshalPinStatus["status"];
  pinnedVersion: string | null;
  installedPluginVersion: string | null;
  legacySkillVersion: string | null;
  aligned: boolean;
}

export interface PinCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type PinCommandRunner = (command: string, args: readonly string[]) => Promise<PinCommandResult>;

export interface PinRuntimeOptions {
  codexBin?: string;
  home?: string;
  fetchImpl?: typeof fetch;
  runner?: PinCommandRunner;
  now?: () => Date;
  codexHome?: string;
  syncLegacyCopies?: boolean;
}

interface CodexPluginList {
  installed?: Array<{
    pluginId?: string;
    version?: string;
    source?: { source?: string; path?: string };
  }>;
}

export function defaultPinStatePath(home = homedir()): string {
  return join(home, ".mandatemarshal", "pin.json");
}

export async function pinMandateMarshal(
  requested: string,
  options: PinRuntimeOptions = {},
): Promise<MandateMarshalPinRecord> {
  const target = await resolvePinTarget(requested, options.fetchImpl ?? fetch);
  const runner = options.runner ?? createBunCommandRunner();
  const codexBin = options.codexBin ?? process.env.MANDATEMARSHAL_CODEX_BIN ?? "codex";

  await verifyPublishedTarget(target.version, target.ref, options.fetchImpl ?? fetch);

  const currentPlugin = await readInstalledPlugin(runner, codexBin);
  const marketplaceConfigured = await isMarketplaceConfigured(runner, codexBin);
  if (currentPlugin) {
    requireSuccess(
      await runner(codexBin, ["plugin", "remove", PLUGIN_SELECTOR, "--json"]),
      "Failed to remove the currently installed MandateMarshal plugin before repinning",
    );
  }
  if (marketplaceConfigured) {
    requireSuccess(
      await runner(codexBin, ["plugin", "marketplace", "remove", MARKETPLACE, "--json"]),
      "Failed to remove the currently configured MandateMarshal marketplace before repinning",
    );
  }

  const marketplaceAdd = await runner(codexBin, [
    "plugin",
    "marketplace",
    "add",
    REPOSITORY,
    "--ref",
    target.ref,
    "--json",
  ]);
  requireSuccess(marketplaceAdd, `Failed to pin MandateMarshal marketplace to ${target.ref}`);
  const marketplaceResult = JSON.parse(marketplaceAdd.stdout) as { installedRoot?: unknown };
  if (typeof marketplaceResult.installedRoot !== "string" || !marketplaceResult.installedRoot.trim()) {
    throw new Error("PIN_VERIFY_FAILED: Codex did not report the pinned marketplace root");
  }

  const pluginAdd = await runner(codexBin, ["plugin", "add", PLUGIN_SELECTOR, "--json"]);
  requireSuccess(pluginAdd, `Failed to install MandateMarshal plugin from ${target.ref}`);

  const installed = await readInstalledPlugin(runner, codexBin);
  if (!installed) throw new Error("PIN_VERIFY_FAILED: MandateMarshal plugin is not installed after pinning");
  if (installed.version !== target.version) {
    throw new Error(`PIN_VERIFY_FAILED: expected ${target.version}, observed ${installed.version ?? "unknown"}`);
  }
  if (!installed.source?.path?.trim()) {
    throw new Error("PIN_VERIFY_FAILED: Codex did not report the installed MandateMarshal plugin source path");
  }

  const runtimeSource = resolve(marketplaceResult.installedRoot);
  const pluginSource = resolve(installed.source.path);
  const pluginRelative = relative(runtimeSource, pluginSource);
  if (pluginRelative.startsWith("..") || isAbsolute(pluginRelative)) {
    throw new Error(`PIN_VERIFY_FAILED: installed plugin source escaped pinned marketplace root: ${pluginSource}`);
  }
  if (options.syncLegacyCopies !== false) {
    await syncLegacyCodexCopies(pluginSource, options.home, options.codexHome);
  }

  const record: MandateMarshalPinRecord = {
    schemaVersion: PIN_STATE_SCHEMA,
    version: target.version,
    ref: target.ref,
    repository: REPOSITORY,
    marketplace: MARKETPLACE,
    pluginSource,
    runtimeSource,
    pinnedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  await writePinRecord(record, options.home);
  return record;
}

export async function inspectMandateMarshalVersion(options: PinRuntimeOptions = {}): Promise<MandateMarshalVersionInfo> {
  const packageVersion = await readMandateMarshalPackageVersion();
  const pin = await inspectMandateMarshalPin(options);
  return {
    version: packageVersion,
    pinStatus: pin.status,
    pinnedVersion: pin.record?.version ?? null,
    installedPluginVersion: pin.installedPluginVersion,
    legacySkillVersion: pin.legacySkillVersion,
    aligned:
      pin.status === "unpinned"
        ? true
        : pin.status === "pinned" &&
          pin.record?.version === packageVersion &&
          pin.installedPluginVersion === packageVersion &&
          pin.legacySkillVersion === packageVersion,
  };
}

export async function inspectMandateMarshalPin(options: PinRuntimeOptions = {}): Promise<MandateMarshalPinStatus> {
  const record = await readPinRecord(options.home);
  if (!record) {
    return { status: "unpinned", record: null, installedPluginVersion: null, legacySkillVersion: null };
  }

  const runner = options.runner ?? createBunCommandRunner();
  const codexBin = options.codexBin ?? process.env.MANDATEMARSHAL_CODEX_BIN ?? "codex";
  const installed = await readInstalledPlugin(runner, codexBin).catch(() => undefined);
  const installedPluginVersion = installed?.version ?? null;
  const legacySkillVersion = await readLegacySkillVersion(options.home, options.codexHome);
  const aligned = installedPluginVersion === record.version && legacySkillVersion === record.version;
  return {
    status: aligned ? "pinned" : "drifted",
    record,
    installedPluginVersion,
    legacySkillVersion,
  };
}

export async function maybeDelegateToPinnedCli(args: readonly string[], options: PinRuntimeOptions = {}): Promise<number | undefined> {
  if (process.env[PIN_EXEC_GUARD] === "1") return undefined;
  if (args[0] === "pin") return undefined;

  const record = await readPinRecord(options.home);
  if (!record) return undefined;

  const pinnedBin = join(record.runtimeSource, "bin", "mandatemarshal.ts");
  if (!(await isFile(pinnedBin))) {
    throw new Error(`PINNED_CLI_MISSING:${pinnedBin}. Run 'mandatemarshal pin ${record.version}' again.`);
  }

  const currentRoot = resolve(import.meta.dir, "../..");
  if (resolve(record.runtimeSource) === currentRoot) return undefined;

  const child = Bun.spawn([process.execPath, pinnedBin, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      [PIN_EXEC_GUARD]: "1",
    },
  });
  return child.exited;
}

export async function readMandateMarshalPackageVersion(): Promise<string> {
  const packagePath = resolve(import.meta.dir, "../..", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (!isVersion(packageJson.version)) throw new Error(`PACKAGE_VERSION_INVALID:${packagePath}`);
  return packageJson.version;
}

export async function readPinRecord(home = homedir()): Promise<MandateMarshalPinRecord | undefined> {
  const path = defaultPinStatePath(home);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const record = JSON.parse(content) as Partial<MandateMarshalPinRecord>;
  if (
    record.schemaVersion !== PIN_STATE_SCHEMA ||
    !isVersion(record.version) ||
    record.ref !== `v${record.version}` ||
    record.repository !== REPOSITORY ||
    record.marketplace !== MARKETPLACE ||
    typeof record.pluginSource !== "string" ||
    !record.pluginSource.trim() ||
    typeof record.runtimeSource !== "string" ||
    !record.runtimeSource.trim() ||
    typeof record.pinnedAt !== "string"
  ) {
    throw new Error(`PIN_STATE_INVALID:${path}`);
  }
  return record as MandateMarshalPinRecord;
}

async function resolvePinTarget(requested: string, fetchImpl: typeof fetch): Promise<{ version: string; ref: string }> {
  const value = requested.trim();
  if (!value) throw new Error("PIN_VERSION_REQUIRED");
  if (value === "latest") {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "MandateMarshal" },
    });
    if (!response.ok) throw new Error(`PIN_RESOLVE_FAILED: GitHub latest release returned ${response.status}`);
    const payload = (await response.json()) as { tag_name?: unknown };
    if (typeof payload.tag_name !== "string") throw new Error("PIN_RESOLVE_FAILED: latest release has no tag_name");
    const version = normalizeVersion(payload.tag_name);
    return { version, ref: `v${version}` };
  }
  const version = normalizeVersion(value);
  return { version, ref: `v${version}` };
}

async function verifyPublishedTarget(version: string, ref: string, fetchImpl: typeof fetch): Promise<void> {
  const release = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "MandateMarshal" },
  });
  if (!release.ok) throw new Error(`PIN_TARGET_NOT_RELEASED:${ref}`);

  const manifestResponse = await fetchImpl(
    `https://raw.githubusercontent.com/${REPOSITORY}/${encodeURIComponent(ref)}/.codex-plugin/plugin.json`,
    { headers: { "User-Agent": "MandateMarshal" } },
  );
  if (!manifestResponse.ok) throw new Error(`PIN_TARGET_MANIFEST_MISSING:${ref}`);
  const manifest = (await manifestResponse.json()) as { version?: unknown };
  if (manifest.version !== version) {
    throw new Error(`PIN_TARGET_VERSION_MISMATCH: package target ${version}, plugin manifest ${String(manifest.version)}`);
  }

  const skillResponse = await fetchImpl(
    `https://raw.githubusercontent.com/${REPOSITORY}/${encodeURIComponent(ref)}/skills/orchestration/SKILL.md`,
    { headers: { "User-Agent": "MandateMarshal" } },
  );
  if (!skillResponse.ok) throw new Error(`PIN_TARGET_SKILL_MISSING:${ref}`);
  const skillVersion = parseSkillVersion(await skillResponse.text());
  if (skillVersion !== version) {
    throw new Error(`PIN_TARGET_VERSION_MISMATCH: package target ${version}, Skill ${skillVersion ?? "missing"}`);
  }
}

function normalizeVersion(value: string): string {
  const version = value.startsWith("v") ? value.slice(1) : value;
  if (!isVersion(version)) throw new Error(`PIN_VERSION_INVALID:${value}`);
  return version;
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}

export function parseSkillVersion(content: string): string | undefined {
  const match = content.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/mu);
  return match?.[1];
}

async function readInstalledPlugin(runner: PinCommandRunner, codexBin: string) {
  const result = await runner(codexBin, ["plugin", "list", "--json"]);
  requireSuccess(result, "Failed to inspect installed Codex plugins");
  const payload = JSON.parse(result.stdout) as CodexPluginList;
  return payload.installed?.find((plugin) => plugin.pluginId === PLUGIN_SELECTOR);
}

async function isMarketplaceConfigured(runner: PinCommandRunner, codexBin: string): Promise<boolean> {
  const result = await runner(codexBin, ["plugin", "marketplace", "list", "--json"]);
  requireSuccess(result, "Failed to inspect configured Codex plugin marketplaces");
  const payload = JSON.parse(result.stdout) as { marketplaces?: Array<{ name?: string }> };
  return payload.marketplaces?.some((marketplace) => marketplace.name === MARKETPLACE) ?? false;
}

function createBunCommandRunner(): PinCommandRunner {
  return async (command, args) => {
    const child = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
}

function requireSuccess(result: PinCommandResult, message: string): void {
  if (result.code === 0) return;
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
  throw new Error(`${message}: ${detail}`);
}

async function readLegacySkillVersion(home = homedir(), codexHome?: string): Promise<string | null> {
  const targetCodexHome = resolve(codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex"));
  const skillPath = join(targetCodexHome, "skills", "mandatemarshal", "SKILL.md");
  try {
    return parseSkillVersion(await readFile(skillPath, "utf8")) ?? null;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function syncLegacyCodexCopies(pluginSource: string, home = homedir(), codexHome?: string): Promise<void> {
  const targetCodexHome = resolve(codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex"));
  const sourceSkill = join(pluginSource, "skills", "mandatemarshal");
  const targetSkill = join(targetCodexHome, "skills", "mandatemarshal");
  if (!(await isDirectory(sourceSkill))) throw new Error(`PIN_PLUGIN_SKILL_MISSING:${sourceSkill}`);
  await mkdir(dirname(targetSkill), { recursive: true });
  await cp(sourceSkill, targetSkill, { recursive: true, force: true });

  const targetAgents = join(targetCodexHome, "agents");
  await mkdir(targetAgents, { recursive: true });
  for (const name of [
    "mandatemarshal_routine_implementer.toml",
    "mandatemarshal_complex_implementer.toml",
    "mandatemarshal_fresh_reviewer.toml",
  ]) {
    const source = join(pluginSource, "agents", name);
    if (!(await isFile(source))) throw new Error(`PIN_PLUGIN_AGENT_MISSING:${source}`);
    await copyFile(source, join(targetAgents, name));
  }
}

async function writePinRecord(record: MandateMarshalPinRecord, home = homedir()): Promise<void> {
  const path = defaultPinStatePath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
