import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { auditRepositories, parseRepoList, sliceForShard, slug } from "../src/audit.js";
import { makeTempDir, removeDir } from "./helpers.js";

test("parses a repos file, ignoring comments, blanks and duplicates", () => {
  const sources = parseRepoList(
    [
      "# projects that should install cleanly",
      "vercel/next.js",
      "",
      "  sindresorhus/got  # a small one",
      "vercel/next.js",
      "https://github.com/expressjs/express",
    ].join("\n"),
  );

  assert.deepEqual(sources, [
    "vercel/next.js",
    "sindresorhus/got",
    "https://github.com/expressjs/express",
  ]);
});

test("turns a repository name into a filename that stays in the directory", () => {
  assert.equal(slug("https://github.com/vercel/next.js"), "vercel__next.js");
  assert.equal(slug("vercel/next.js"), "vercel__next.js");
  assert.equal(slug("/Users/mayank/src/app"), "app");
  assert.equal(slug("../../../etc/passwd"), "passwd");
});

test("audits local repositories and records a passing and a failing one", async () => {
  const passing = await makeTempDir();
  const failing = await makeTempDir();
  const output = await makeTempDir();

  try {
    await writeFile(path.join(passing, "package.json"), "{}\n");
    await writeFile(
      path.join(passing, "README.md"),
      ["## Setup", "```bash", "echo installed", "```"].join("\n"),
    );

    await writeFile(path.join(failing, "package.json"), "{}\n");
    await writeFile(
      path.join(failing, "README.md"),
      ["## Setup", "```bash", "exit 7", "```"].join("\n"),
    );

    const summary = await auditRepositories({
      sources: [passing, failing],
      outputDirectory: output,
      runner: "local",
      image: null,
      timeoutMs: 20_000,
      keepGoing: false,
    });

    assert.equal(summary.totals.repositories, 2);
    assert.equal(summary.totals.checked, 2);
    assert.equal(summary.totals.withFailures, 1);
    assert.equal(summary.totals.errors, 0);

    const written = JSON.parse(await readFile(path.join(output, "summary.json"), "utf8"));
    assert.equal(written.totals.withFailures, 1);

    const failedReport = written.entries.find(
      (entry: { report: { summary: { failed: number } } | null }) =>
        entry.report && entry.report.summary.failed > 0,
    );
    assert.ok(failedReport);
  } finally {
    await removeDir(passing);
    await removeDir(failing);
    await removeDir(output);
  }
});

test("a shard takes an interleaved slice, not a block", () => {
  const sources = ["a", "b", "c", "d", "e", "f", "g"];

  assert.deepEqual(sliceForShard(sources, { index: 2, total: 3 }), ["b", "e"]);
  assert.deepEqual(sliceForShard(sources, { index: 3, total: 3 }), ["c", "f"]);
  assert.deepEqual(sliceForShard(sources, { index: 1, total: 1 }), sources);
});

test("a repository whose README has nothing to run is not counted as healthy", async () => {
  const repository = await makeTempDir();
  const output = await makeTempDir();

  try {
    await writeFile(path.join(repository, "package.json"), "{}\n");
    await writeFile(
      path.join(repository, "README.md"),
      ["## Usage", "```bash", "thing --help", "```"].join("\n"),
    );

    const summary = await auditRepositories({
      sources: [repository],
      outputDirectory: output,
      runner: "local",
      image: null,
      timeoutMs: 5_000,
      keepGoing: false,
    });

    assert.equal(summary.entries[0].status, "no-steps");
    assert.equal(summary.totals.noSteps, 1);
    assert.equal(summary.totals.checked, 0);
  } finally {
    await removeDir(repository);
    await removeDir(output);
  }
});

test("a dry-run audit plans every repository and executes nothing", async () => {
  const repository = await makeTempDir();
  const output = await makeTempDir();
  const marker = path.join(repository, "should-not-exist");

  try {
    await writeFile(path.join(repository, "package.json"), "{}\n");
    await writeFile(
      path.join(repository, "README.md"),
      ["## Setup", "```bash", `touch ${marker}`, "```"].join("\n"),
    );

    const summary = await auditRepositories({
      sources: [repository],
      outputDirectory: output,
      runner: "local",
      image: null,
      timeoutMs: 5_000,
      keepGoing: false,
      dryRun: true,
    });

    assert.equal(summary.dryRun, true);
    assert.equal(summary.totals.planned, 1);
    assert.equal(summary.totals.checked, 0);
    assert.equal(summary.entries[0].status, "planned");
    assert.equal(summary.entries[0].planned?.runnable, 1);
    assert.deepEqual(summary.entries[0].planned?.sections, ["Setup"]);

    await assert.rejects(access(marker));
  } finally {
    await removeDir(repository);
    await removeDir(output);
  }
});

test("a missing repository becomes an error entry instead of stopping the run", async () => {
  const output = await makeTempDir();

  try {
    const summary = await auditRepositories({
      sources: ["/definitely/not/here"],
      outputDirectory: output,
      runner: "local",
      image: null,
      timeoutMs: 5_000,
      keepGoing: false,
    });

    assert.equal(summary.totals.errors, 1);
    assert.equal(summary.entries[0].status, "error");
  } finally {
    await removeDir(output);
  }
});
