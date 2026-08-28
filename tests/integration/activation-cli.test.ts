import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(storage: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "bin/mandatemarshal.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, MANDATEMARSHAL_HOME: storage },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("activation CLI enables, observes, and disables without dirtying target project", async () => {
  const project = await mkdtemp(join(tmpdir(), "mandatemarshal-cli-project-"));
  const storage = await mkdtemp(join(tmpdir(), "mandatemarshal-cli-home-"));
  try {
    const enabled = await runCli(storage, ["activation", "enable", project]);
    expect(enabled.code).toBe(0);
    expect(JSON.parse(enabled.stdout).status).toBe("enabled");

    const status = await runCli(storage, ["activation", "status", project]);
    expect(status.code).toBe(0);
    const statusPayload = JSON.parse(status.stdout);
    expect(statusPayload.status).toBe("enabled");
    expect(statusPayload.record.enabled).toBeTrue();

    const disabled = await runCli(storage, ["activation", "disable", project]);
    expect(disabled.code).toBe(0);
    expect(JSON.parse(disabled.stdout).status).toBe("disabled");

    expect(await readdir(project)).toEqual([]);
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(storage, { recursive: true, force: true }),
    ]);
  }
});
