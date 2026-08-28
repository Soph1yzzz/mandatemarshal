import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistRunArtifacts } from "../../src/runtime/evidence-store";
import { evidence } from "../fixtures/factories";

test("persisted run evidence cannot overwrite an existing run id", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-evidence-"));
  try {
    const bundle = {
      run: { schemaVersion: 1, status: "completed" },
      events: [],
      evidence: evidence(),
    };
    await persistRunArtifacts("stable-run", bundle, root);
    await expect(persistRunArtifacts("stable-run", bundle, root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
