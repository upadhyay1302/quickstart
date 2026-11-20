import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { checkRepository } from "../src/check.js";
import { dockerAvailable, dockerRunArgs } from "../src/runner.js";
import { makeTempDir, removeDir } from "./helpers.js";

const script = "set -e\nnpm ci\n";

test("mounts the copied repository and works inside it", () => {
  const args = dockerRunArgs("/tmp/repo", "node:20-bookworm", script);

  assert.deepEqual(args.slice(0, 4), ["run", "--rm", "--init", "--volume"]);
  assert.equal(args[4], "/tmp/repo:/work");
  assert.equal(args[args.indexOf("--workdir") + 1], "/work");
});

test("scrubs the environment to CI and a scratch HOME", () => {
  const args = dockerRunArgs("/tmp/repo", "node:20-bookworm", script);
  const env = args.filter((arg, index) => args[index - 1] === "--env");

  assert.deepEqual(env, ["CI=1", "HOME=/tmp", "DEBIAN_FRONTEND=noninteractive"]);
});

test("runs the script through bash and ends on the image command", () => {
  const args = dockerRunArgs("/tmp/repo", "python:3.12-bookworm", script);

  assert.ok(args.includes("python:3.12-bookworm"));
  assert.deepEqual(args.slice(-3), ["bash", "-lc", script]);
});

test("a step really runs in a container when Docker is available", async (t) => {
  // The argv tests above prove the command line looks right. This one proves a
  // container starts, the checkout is visible inside it, and its exit code
  // comes back. Skipped rather than failed on machines without a daemon.
  if (!(await dockerAvailable())) {
    t.skip("Docker is not available here");
    return;
  }

  const repository = await makeTempDir();

  try {
    await writeFile(
      path.join(repository, "README.md"),
      ["## Setup", "```bash", "echo ran-in-container", "```"].join("\n"),
    );

    const report = await checkRepository(repository, {
      runner: "docker",
      image: "debian:bookworm-slim",
      timeoutMs: 120_000,
      keepGoing: false,
    });

    assert.equal(report.runner, "docker");
    assert.equal(report.steps[0].status, "passed");
    assert.equal(report.summary.passed, 1);
    assert.match(report.steps[0].output, /ran-in-container/);
  } finally {
    await removeDir(repository);
  }
});
