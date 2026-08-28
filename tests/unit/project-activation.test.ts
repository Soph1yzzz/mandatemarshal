import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  disableProjectActivation,
  enableProjectActivation,
  projectActivationId,
  readProjectActivation,
  resolveProjectActivation,
} from "../../src/runtime/project-activation";

describe("project activation registry", () => {
  test("explicit first invocation persists outside the target repository", async () => {
    const project = await mkdtemp(join(tmpdir(), "mandatemarshal-project-"));
    const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-home-"));
    try {
      expect(await readdir(project)).toEqual([]);
      const first = await resolveProjectActivation(project, true, { storageRoot: storage });
      expect(first.enabled).toBeTrue();
      expect(first.reason).toBe("explicit-invocation");
      expect(await readdir(project)).toEqual([]);

      const later = await resolveProjectActivation(project, false, { storageRoot: storage });
      expect(later.enabled).toBeTrue();
      expect(later.reason).toBe("project-activation");
      expect(later.record?.projectId).toBe(first.record?.projectId);
    } finally {
      await Promise.all([
        rm(project, { recursive: true, force: true }),
        rm(storage, { recursive: true, force: true }),
      ]);
    }
  });

  test("unregistered projects do not activate implicitly", async () => {
    const project = await mkdtemp(join(tmpdir(), "mandatemarshal-project-"));
    const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-home-"));
    try {
      const decision = await resolveProjectActivation(project, false, { storageRoot: storage });
      expect(decision.enabled).toBeFalse();
      expect(decision.reason).toBe("not-activated");
      expect(await readProjectActivation(project, { storageRoot: storage })).toBeUndefined();
    } finally {
      await Promise.all([
        rm(project, { recursive: true, force: true }),
        rm(storage, { recursive: true, force: true }),
      ]);
    }
  });

  test("explicit disable prevents later implicit activation", async () => {
    const project = await mkdtemp(join(tmpdir(), "mandatemarshal-project-"));
    const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-home-"));
    try {
      await enableProjectActivation(project, { storageRoot: storage });
      const disabled = await disableProjectActivation(project, { storageRoot: storage });
      expect(disabled.enabled).toBeFalse();
      expect(disabled.disabledAt).toBeDefined();

      const decision = await resolveProjectActivation(project, false, { storageRoot: storage });
      expect(decision.enabled).toBeFalse();
      expect(decision.reason).toBe("not-activated");
    } finally {
      await Promise.all([
        rm(project, { recursive: true, force: true }),
        rm(storage, { recursive: true, force: true }),
      ]);
    }
  });

  test("tampered activation record fails closed", async () => {
    const project = await mkdtemp(join(tmpdir(), "mandatemarshal-project-"));
    const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-home-"));
    try {
      const record = await enableProjectActivation(project, { storageRoot: storage });
      const [file] = await readdir(join(storage, "projects"));
      if (!file) throw new Error("activation record missing");
      await writeFile(join(storage, "projects", file), JSON.stringify({ ...record, projectId: "0".repeat(64) }), "utf8");
      expect(readProjectActivation(project, { storageRoot: storage })).rejects.toThrow("projectId mismatch");
    } finally {
      await Promise.all([
        rm(project, { recursive: true, force: true }),
        rm(storage, { recursive: true, force: true }),
      ]);
    }
  });

  test("explicit activation rejects a missing project path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "mandatemarshal-missing-parent-"));
    const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-home-"));
    try {
      const missing = join(parent, "does-not-exist");
      await expect(enableProjectActivation(missing, { storageRoot: storage })).rejects.toThrow(
        "Cannot activate missing project directory",
      );
    } finally {
      await Promise.all([
        rm(parent, { recursive: true, force: true }),
        rm(storage, { recursive: true, force: true }),
      ]);
    }
  });

  test("project identity is stable for the same canonical path", async () => {
    const project = await mkdtemp(join(tmpdir(), "mandatemarshal-project-"));
    try {
      const a = await projectActivationId(project);
      const b = await projectActivationId(project);
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
