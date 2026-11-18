import assert from "node:assert/strict";
import test from "node:test";

import { dockerRunArgs } from "../src/runner.js";

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
