import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
it("configures repository protections without changing visibility", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edu-github-test-"));
  const log = join(directory, "calls.jsonl");
  try {
    await writeFile(
      join(directory, "gh"),
      `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const body=args.includes('--input')?fs.readFileSync(0,'utf8'):'';fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({args,body})+'\\n');if(args.includes('--jq'))console.log('test-main-sha');`,
      { mode: 0o700 },
    );
    await promisify(execFile)(
      "sh",
      ["scripts/github-setup.sh", "example/edu", join(directory, "absent.env")],
      {
        env: {
          ...process.env,
          PATH: directory + ":" + process.env.PATH,
          CALL_LOG: log,
        },
      },
    );
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const security = calls.find((c) =>
      c.body.includes("security_and_analysis"),
    );
    expect(JSON.parse(security.body)).toEqual({
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
      },
    });
    expect(
      calls.some(
        (c) =>
          c.args.includes("repos/example/edu/vulnerability-alerts") &&
          c.args.includes("PUT"),
      ),
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(
      /private=|visibility|R2_ACCESS_KEY|R2_SECRET/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
