import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const REPOSITORY = "Soph1yzzz/mandatemarshal";
const MARKETPLACE = "mandatemarshal";
const PLUGIN_SELECTOR = "mandatemarshal@mandatemarshal";
const PIN_STATE_SCHEMA = 2 as const;
const PIN_EXEC_GUARD = "MANDATEMARSHAL_PINNED_EXEC";

export interface MandateMarshalPinRecord {
  schemaVersion: 2;
  version: string;
  ref: string;
  repository: string;
  marketplace: string;
  marketplaceSource: string;
  runtimeSource: string;
  pluginCacheSource: string;
  pinnedAt: string;
}

interface MandateMarshalPinRecordV1 {
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
  pluginCacheVersion: string | null;
  pluginCacheSkillVersion: string | null;
  legacySkillVersion: string | null;
}

export interface MandateMarshalVersionInfo {
  version: string;
  pinStatus: MandateMarshalPinStatus["status"];
  pinnedVersion: string | null;
  installedPluginVersion: string | null;
  pluginCacheVersion: string | null;
  pluginCacheSkillVersion: string | null;
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
  which?: (command: string) => string | undefined;
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
  const codexBin = await resolveCodexBin(options);

  const fetchImpl = options.fetchImpl ?? fetch;
  const published = await verifyPublishedTarget(target.version, target.ref, fetchImpl);
  const legacySkill = await inspectLegacySkillForCleanup(options.home, options.codexHome, fetchImpl);

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

  const marketplaceSource = resolve(marketplaceResult.installedRoot);
  const installedMarketplacePluginSource = resolve(installed.source.path);
  const pluginRelative = relative(marketplaceSource, installedMarketplacePluginSource);
  if (pluginRelative.startsWith("..") || isAbsolute(pluginRelative)) {
    throw new Error(
      `PIN_VERIFY_FAILED: installed marketplace plugin source escaped pinned marketplace root: ${installedMarketplacePluginSource}`,
    );
  }

  const runtimeSource = marketplaceSource;
  const pluginCacheSource = expectedPluginCacheSource(target.version, options.home, options.codexHome);
  await verifyPluginCache(pluginCacheSource, target.version, published.skillHash);
  if (legacySkill.kind === "managed") {
    await unlink(legacySkill.skillPath);
  }

  const record: MandateMarshalPinRecord = {
    schemaVersion: PIN_STATE_SCHEMA,
    version: target.version,
    ref: target.ref,
    repository: REPOSITORY,
    marketplace: MARKETPLACE,
    marketplaceSource,
    runtimeSource,
    pluginCacheSource,
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
    pluginCacheVersion: pin.pluginCacheVersion,
    pluginCacheSkillVersion: pin.pluginCacheSkillVersion,
    legacySkillVersion: pin.legacySkillVersion,
    aligned:
      pin.status === "unpinned"
        ? true
        : pin.status === "pinned" &&
          pin.record?.version === packageVersion &&
          pin.installedPluginVersion === packageVersion &&
          pin.pluginCacheVersion === packageVersion &&
          pin.pluginCacheSkillVersion === packageVersion &&
          pin.legacySkillVersion === null,
  };
}

export async function inspectMandateMarshalPin(options: PinRuntimeOptions = {}): Promise<MandateMarshalPinStatus> {
  const record = await readPinRecord(options.home, options.codexHome);
  if (!record) {
    return {
      status: "unpinned",
      record: null,
      installedPluginVersion: null,
      pluginCacheVersion: null,
      pluginCacheSkillVersion: null,
      legacySkillVersion: await readLegacySkillVersion(options.home, options.codexHome),
    };
  }

  const runner = options.runner ?? createBunCommandRunner();
  const codexBin = await resolveCodexBin(options);
  const installed = await readInstalledPlugin(runner, codexBin).catch(() => undefined);
  const installedPluginVersion = installed?.version ?? null;
  const cache = await inspectPluginCache(record.pluginCacheSource);
  const legacySkillVersion = await readLegacySkillVersion(options.home, options.codexHome);
  const aligned =
    installedPluginVersion === record.version &&
    cache.pluginVersion === record.version &&
    cache.skillVersion === record.version &&
    legacySkillVersion === null;
  return {
    status: aligned ? "pinned" : "drifted",
    record,
    installedPluginVersion,
    pluginCacheVersion: cache.pluginVersion,
    pluginCacheSkillVersion: cache.skillVersion,
    legacySkillVersion,
  };
}

export async function maybeDelegateToPinnedCli(args: readonly string[], options: PinRuntimeOptions = {}): Promise<number | undefined> {
  if (process.env[PIN_EXEC_GUARD] === "1") return undefined;
  if (args[0] === "pin") return undefined;

  const record = await readPinRecord(options.home, options.codexHome);
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

export async function readPinRecord(
  home = homedir(),
  codexHome?: string,
): Promise<MandateMarshalPinRecord | undefined> {
  const path = defaultPinStatePath(home);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const raw = JSON.parse(content) as Partial<MandateMarshalPinRecord> & Partial<MandateMarshalPinRecordV1>;
  if (
    !isVersion(raw.version) ||
    raw.ref !== `v${raw.version}` ||
    raw.repository !== REPOSITORY ||
    raw.marketplace !== MARKETPLACE ||
    typeof raw.runtimeSource !== "string" ||
    !raw.runtimeSource.trim() ||
    typeof raw.pinnedAt !== "string"
  ) {
    throw new Error(`PIN_STATE_INVALID:${path}`);
  }

  if (raw.schemaVersion === 2) {
    if (
      typeof raw.marketplaceSource !== "string" ||
      !raw.marketplaceSource.trim() ||
      typeof raw.pluginCacheSource !== "string" ||
      !raw.pluginCacheSource.trim()
    ) {
      throw new Error(`PIN_STATE_INVALID:${path}`);
    }
    return raw as MandateMarshalPinRecord;
  }

  if (raw.schemaVersion === 1 && typeof raw.pluginSource === "string" && raw.pluginSource.trim()) {
    return {
      schemaVersion: 2,
      version: raw.version,
      ref: raw.ref,
      repository: REPOSITORY,
      marketplace: MARKETPLACE,
      marketplaceSource: resolve(raw.runtimeSource),
      runtimeSource: resolve(raw.runtimeSource),
      pluginCacheSource: expectedPluginCacheSource(raw.version, home, codexHome),
      pinnedAt: raw.pinnedAt,
    };
  }

  throw new Error(`PIN_STATE_INVALID:${path}`);
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

async function verifyPublishedTarget(
  version: string,
  ref: string,
  fetchImpl: typeof fetch,
): Promise<{ skillHash: string }> {
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
  const skillContent = await skillResponse.text();
  const skillVersion = parseSkillVersion(skillContent);
  if (skillVersion !== version) {
    throw new Error(`PIN_TARGET_VERSION_MISMATCH: package target ${version}, Skill ${skillVersion ?? "missing"}`);
  }
  return { skillHash: skillSha256(skillContent) };
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

export function expectedPluginCacheSource(version: string, home = homedir(), codexHome?: string): string {
  const targetCodexHome = resolve(codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex"));
  return join(targetCodexHome, "plugins", "cache", MARKETPLACE, "mandatemarshal", version);
}

async function verifyPluginCache(pluginCacheSource: string, version: string, publishedSkillHash: string): Promise<void> {
  const manifestPath = join(pluginCacheSource, ".codex-plugin", "plugin.json");
  const skillPath = join(pluginCacheSource, "skills", "mandatemarshal", "SKILL.md");
  let manifestContent: string;
  let skillContent: string;
  try {
    [manifestContent, skillContent] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(skillPath, "utf8"),
    ]);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      throw new Error(`PIN_CACHE_MISSING:${pluginCacheSource}`);
    }
    throw error;
  }

  const manifest = JSON.parse(manifestContent) as { version?: unknown };
  if (manifest.version !== version) {
    throw new Error(`PIN_CACHE_VERSION_MISMATCH: expected ${version}, observed ${String(manifest.version)}`);
  }
  const skillVersion = parseSkillVersion(skillContent);
  if (skillVersion !== version) {
    throw new Error(`PIN_CACHE_SKILL_VERSION_MISMATCH: expected ${version}, observed ${skillVersion ?? "missing"}`);
  }
  if (skillSha256(skillContent) !== publishedSkillHash) {
    throw new Error(`PIN_CACHE_SKILL_HASH_MISMATCH:${skillPath}`);
  }
}

async function inspectPluginCache(
  pluginCacheSource: string,
): Promise<{ pluginVersion: string | null; skillVersion: string | null }> {
  try {
    const [manifestContent, skillContent] = await Promise.all([
      readFile(join(pluginCacheSource, ".codex-plugin", "plugin.json"), "utf8"),
      readFile(join(pluginCacheSource, "skills", "mandatemarshal", "SKILL.md"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestContent) as { version?: unknown };
    return {
      pluginVersion: isVersion(manifest.version) ? manifest.version : null,
      skillVersion: parseSkillVersion(skillContent) ?? null,
    };
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return { pluginVersion: null, skillVersion: null };
    throw error;
  }
}

async function inspectLegacySkillForCleanup(
  home = homedir(),
  codexHome: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ kind: "absent" } | { kind: "managed"; skillPath: string }> {
  const targetCodexHome = resolve(codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex"));
  const directory = join(targetCodexHome, "skills", "mandatemarshal");
  const skillPath = join(directory, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillPath, "utf8");
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return { kind: "absent" };
    throw error;
  }

  const version = parseSkillVersion(content);
  if (!version) throw new Error(`LEGACY_SKILL_CONFLICT:${skillPath}:missing-version`);
  const release = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/tags/v${version}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "MandateMarshal" },
  });
  if (!release.ok) throw new Error(`LEGACY_SKILL_CONFLICT:${skillPath}:unreleased-version-${version}`);
  const response = await fetchImpl(
    `https://raw.githubusercontent.com/${REPOSITORY}/v${version}/skills/orchestration/SKILL.md`,
    { headers: { "User-Agent": "MandateMarshal" } },
  );
  if (!response.ok) throw new Error(`LEGACY_SKILL_CONFLICT:${skillPath}:unverified-version-${version}`);
  const published = await response.text();
  if (skillSha256(content) !== skillSha256(published)) {
    throw new Error(`LEGACY_SKILL_CONFLICT:${skillPath}:content-mismatch`);
  }
  return { kind: "managed", skillPath };
}

function skillSha256(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n?/gu, "\n")).digest("hex");
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

export async function resolveCodexBin(options: PinRuntimeOptions = {}): Promise<string> {
  if (options.codexBin?.trim()) return options.codexBin;
  if (process.env.MANDATEMARSHAL_CODEX_BIN?.trim()) return process.env.MANDATEMARSHAL_CODEX_BIN;
  if (options.runner) return "codex";

  const fromPath = (options.which ?? Bun.which)("codex");
  if (fromPath) return fromPath;

  const home = resolve(options.home ?? homedir());
  const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex"));
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    join(codexHome, "plugins", ".plugin-appserver", executable),
    join(codexHome, ".sandbox-bin", executable),
    ...(process.platform === "win32"
      ? [
          join(home, "AppData", "Roaming", "npm", "codex.cmd"),
          join(home, "AppData", "Roaming", "npm", "codex.exe"),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }

  throw new Error(
    "CODEX_CLI_NOT_FOUND: install Codex CLI or set MANDATEMARSHAL_CODEX_BIN to the Codex executable path",
  );
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
