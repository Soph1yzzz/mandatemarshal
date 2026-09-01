import { open, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { RunEvent, RunMachineSnapshot, RunState } from "../core/types";

export type DurableJournalEntryType =
  | "machine-event"
  | "operation-intent"
  | "operation-observation"
  | "operation-completed"
  | "operation-abandoned"
  | "operator-command"
  | "note";

export interface DurableJournalEntry<T = unknown> {
  schemaVersion: 1;
  sequence: number;
  runId: string;
  at: string;
  type: DurableJournalEntryType;
  state: RunState;
  operationId?: string;
  payload?: T;
}

export interface DurableRunSnapshot<TState = unknown> {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  createdAt: string;
  machine: RunMachineSnapshot;
  state: TState;
}

export interface DurableRunMetadata {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
}

export interface DurableRunRecovery<TState = unknown> {
  snapshot?: DurableRunSnapshot<TState>;
  journal: DurableJournalEntry[];
  machineEvents: RunEvent[];
  entriesAfterSnapshot: DurableJournalEntry[];
}

export function defaultDurableRunRoot(): string {
  return join(homedir(), ".mandatemarshal", "runtime");
}

export class DurableRunStore {
  readonly runDir: string;
  readonly journalPath: string;
  readonly snapshotsDir: string;
  private nextSequence = 1;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly runId: string,
    readonly root: string,
  ) {
    const resolvedRoot = resolve(root);
    this.runDir = resolve(resolvedRoot, runId);
    this.journalPath = join(this.runDir, "events.jsonl");
    this.snapshotsDir = join(this.runDir, "snapshots");
  }

  static async create(runId: string, root = defaultDurableRunRoot()): Promise<DurableRunStore> {
    assertSafeRunId(runId);
    const store = new DurableRunStore(runId, root);
    await mkdir(resolve(root), { recursive: true, mode: 0o700 });
    await mkdir(store.runDir, { mode: 0o700 });
    await mkdir(store.snapshotsDir, { mode: 0o700 });
    await writeExclusiveJson(join(store.runDir, "meta.json"), {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
    } satisfies DurableRunMetadata);
    await writeExclusiveText(store.journalPath, "");
    return store;
  }

  static async open(runId: string, root = defaultDurableRunRoot()): Promise<DurableRunStore> {
    assertSafeRunId(runId);
    const store = new DurableRunStore(runId, root);
    const metadata = parseJson<DurableRunMetadata>(await readFile(join(store.runDir, "meta.json"), "utf8"));
    if (metadata.schemaVersion !== 1 || metadata.runId !== runId) {
      throw new Error(`Durable run metadata mismatch for ${runId}`);
    }
    const journal = await store.readJournal();
    store.nextSequence = (journal.at(-1)?.sequence ?? 0) + 1;
    return store;
  }

  async append<T>(input: {
    type: DurableJournalEntryType;
    state: RunState;
    payload?: T;
    operationId?: string;
  }): Promise<DurableJournalEntry<T>> {
    let created!: DurableJournalEntry<T>;
    await this.enqueue(async () => {
      const entry: DurableJournalEntry<T> = {
        schemaVersion: 1,
        sequence: this.nextSequence,
        runId: this.runId,
        at: new Date().toISOString(),
        type: input.type,
        state: input.state,
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      };
      await appendAndSync(this.journalPath, `${JSON.stringify(entry)}\n`);
      this.nextSequence += 1;
      created = entry;
    });
    return created;
  }

  async appendMachineEvents(events: readonly RunEvent[], fromIndex = 0): Promise<number> {
    if (fromIndex < 0 || fromIndex > events.length) throw new Error("Invalid machine event offset");
    for (let index = fromIndex; index < events.length; index += 1) {
      const event = events[index];
      if (!event) continue;
      if (event.runId !== this.runId) throw new Error(`Machine event runId mismatch: ${event.runId}`);
      await this.append({ type: "machine-event", state: event.state, payload: event });
    }
    return events.length;
  }

  async writeSnapshot<TState>(machine: RunMachineSnapshot, state: TState): Promise<DurableRunSnapshot<TState>> {
    if (machine.runId !== this.runId) throw new Error(`Snapshot runId mismatch: ${machine.runId}`);
    await this.writeQueue;
    const snapshot: DurableRunSnapshot<TState> = {
      schemaVersion: 1,
      runId: this.runId,
      sequence: this.nextSequence - 1,
      createdAt: new Date().toISOString(),
      machine,
      state,
    };
    const filename = `${String(snapshot.sequence).padStart(12, "0")}-${Date.now()}.json`;
    await writeExclusiveJson(join(this.snapshotsDir, filename), snapshot);
    return snapshot;
  }

  async readJournal(): Promise<DurableJournalEntry[]> {
    const content = await readFile(this.journalPath, "utf8");
    const lines = content.split(/\r?\n/u).filter((line) => line.length > 0);
    const entries: DurableJournalEntry[] = [];
    let expected = 1;
    for (const line of lines) {
      const entry = parseJson<DurableJournalEntry>(line);
      if (entry.schemaVersion !== 1) throw new Error(`Unsupported durable journal schema: ${entry.schemaVersion}`);
      if (entry.runId !== this.runId) throw new Error(`Journal runId mismatch: expected ${this.runId}, got ${entry.runId}`);
      if (entry.sequence !== expected) {
        throw new Error(`Durable journal sequence gap: expected ${expected}, got ${entry.sequence}`);
      }
      entries.push(entry);
      expected += 1;
    }
    return entries;
  }

  async readLatestSnapshot<TState>(): Promise<DurableRunSnapshot<TState> | undefined> {
    const names = (await readdir(this.snapshotsDir)).filter((name) => name.endsWith(".json")).sort();
    const latest = names.at(-1);
    if (!latest) return undefined;
    const snapshot = parseJson<DurableRunSnapshot<TState>>(await readFile(join(this.snapshotsDir, latest), "utf8"));
    if (snapshot.schemaVersion !== 1 || snapshot.runId !== this.runId) {
      throw new Error(`Durable snapshot metadata mismatch for ${this.runId}`);
    }
    return snapshot;
  }

  async recover<TState>(): Promise<DurableRunRecovery<TState>> {
    const [journal, snapshot] = await Promise.all([
      this.readJournal(),
      this.readLatestSnapshot<TState>(),
    ]);
    const snapshotSequence = snapshot?.sequence ?? 0;
    const journalLast = journal.at(-1)?.sequence ?? 0;
    if (snapshotSequence > journalLast) {
      throw new Error(`Snapshot sequence ${snapshotSequence} is ahead of journal ${journalLast}`);
    }
    const machineEvents = journal
      .filter((entry) => entry.type === "machine-event")
      .map((entry) => entry.payload)
      .filter((payload): payload is RunEvent => isRunEvent(payload, this.runId));
    return {
      ...(snapshot === undefined ? {} : { snapshot }),
      journal,
      machineEvents,
      entriesAfterSnapshot: journal.filter((entry) => entry.sequence > snapshotSequence),
    };
  }

  async clearSnapshotsForTests(): Promise<void> {
    const names = await readdir(this.snapshotsDir);
    await Promise.all(names.map((name) => unlink(join(this.snapshotsDir, name))));
  }

  private async enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(work, work);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }
}

function isRunEvent(value: unknown, runId: string): value is RunEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<RunEvent>;
  return event.schemaVersion === 1 && event.runId === runId && typeof event.type === "string" && typeof event.at === "string";
}

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(runId)) throw new Error("Unsafe runId");
}

function parseJson<T>(content: string): T {
  return JSON.parse(content) as T;
}

async function appendAndSync(path: string, content: string): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(content, undefined, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveText(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  await writeExclusiveText(path, `${JSON.stringify(value, null, 2)}\n`);
}
