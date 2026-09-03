import { expect, test } from "bun:test";

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "bin/mandatemarshal.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MANDATEMARSHAL_PINNED_EXEC: "1",
    },
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

test("--version and -v print the package release version without consulting pin state", async () => {
  for (const flag of ["--version", "-v"]) {
    const result = await runCli([flag]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("0.2.2");
  }
});
