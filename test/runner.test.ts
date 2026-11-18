import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { copyRepository, runProcess } from "../src/runner.js";
import { makeTempDir, removeDir } from "./helpers.js";

const baseEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

test("copies source files and leaves installed dependencies behind", async () => {
  const source = await makeTempDir();
  const destination = await makeTempDir();
  const target = path.join(destination, "copy");

  try {
    await mkdir(path.join(source, "src"), { recursive: true });
    await mkdir(path.join(source, "node_modules", "left-pad"), { recursive: true });
    await writeFile(path.join(source, "src", "index.js"), "export {};\n");
    await writeFile(path.join(source, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");

    await copyRepository(source, target);

    const { readdir } = await import("node:fs/promises");
    const copied = await readdir(target);
    assert.ok(copied.includes("src"));
    assert.ok(!copied.includes("node_modules"));
  } finally {
    await removeDir(source);
    await removeDir(destination);
  }
});

test("runProcess reports the exit code and merged output", async () => {
  const result = await runProcess("bash", ["-lc", "echo hello; echo oops >&2; exit 3"], {
    env: baseEnv,
    timeoutMs: 5_000,
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /hello/);
  assert.match(result.output, /oops/);
});

test("runProcess kills a command that runs too long", async () => {
  const result = await runProcess("bash", ["-lc", "sleep 5"], {
    env: baseEnv,
    timeoutMs: 150,
  });

  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 2_000, `took ${result.durationMs}ms`);
});

test("runProcess does not throw when the binary is missing", async () => {
  const result = await runProcess("quickstart-no-such-binary", [], {
    env: baseEnv,
    timeoutMs: 1_000,
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.timedOut, false);
});
