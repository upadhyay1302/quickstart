import assert from "node:assert/strict";
import test from "node:test";

import { UsageError, parseArguments, parseDuration } from "../src/args.js";

test("defaults to checking the current directory in auto mode", () => {
  const options = parseArguments([]);

  assert.equal(options.command, "check");
  assert.equal(options.target, ".");
  assert.equal(options.runner, "auto");
  assert.equal(options.timeoutMs, 5 * 60 * 1000);
  assert.equal(options.keepGoing, false);
});

test("reads the command and the path", () => {
  const options = parseArguments(["check", "./fixtures/app"]);
  assert.equal(options.command, "check");
  assert.equal(options.target, "./fixtures/app");
});

test("a bare path is shorthand for check", () => {
  const options = parseArguments(["./fixtures/app"]);
  assert.equal(options.command, "check");
  assert.equal(options.target, "./fixtures/app");
});

test("collects runner and output flags", () => {
  const options = parseArguments(["--local", "--json", "--verbose", "--keep-going"]);

  assert.equal(options.runner, "local");
  assert.equal(options.json, true);
  assert.equal(options.verbose, true);
  assert.equal(options.keepGoing, true);
});

test("--local and --docker together is a usage error", () => {
  assert.throws(() => parseArguments(["--local", "--docker"]), UsageError);
});

test("an unknown flag is a usage error, not a crash", () => {
  assert.throws(() => parseArguments(["--nope"]), UsageError);
});

test("--help wins over the command", () => {
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["help"]).help, true);
});

test("a flag the chosen command would ignore is a usage error", () => {
  assert.throws(() => parseArguments(["check", "--shard", "2/4"]), UsageError);
  assert.throws(() => parseArguments(["--out", "results"]), UsageError);
  assert.throws(() => parseArguments(["audit", "--json"]), UsageError);
  assert.throws(() => parseArguments(["audit", "--verbose"]), UsageError);
});

test("the same flags are accepted by the command that uses them", () => {
  assert.deepEqual(parseArguments(["audit", "--shard", "2/4"]).shard, {
    index: 2,
    total: 4,
  });
  assert.equal(parseArguments(["audit", "--out", "out"]).out, "out");
  assert.equal(parseArguments(["check", "--json"]).json, true);
  assert.equal(parseArguments(["check", "--verbose"]).verbose, true);
});

test("--help does not depend on the other flags being right", () => {
  assert.equal(parseArguments(["check", "--shard", "2/4", "--help"]).help, true);
});

test("parses durations the way people write them", () => {
  assert.equal(parseDuration("90s"), 90_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("1h"), 3_600_000);
  assert.equal(parseDuration("500"), 500_000);
  assert.equal(parseDuration("250ms"), 250);
});

test("rejects a duration that is not one", () => {
  assert.throws(() => parseDuration("soon"), UsageError);
});
