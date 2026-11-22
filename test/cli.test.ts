import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runProcess } from "../src/runner.js";
import { makeTempDir, removeDir } from "./helpers.js";

const CLI = new URL("../src/main.js", import.meta.url).pathname;

const README = `# fixture

## Setup

\`\`\`bash
echo first step
\`\`\`

\`\`\`bash
exit 4
\`\`\`

## Usage

\`\`\`bash
echo this is usage, not setup
\`\`\`
`;

async function runCli(args: string[]) {
  return runProcess(process.execPath, [CLI, ...args], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMs: 30_000,
  });
}

test("reports a passing and a failing step, and exits 1", async () => {
  const repo = await makeTempDir();
  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(path.join(repo, "README.md"), README);

    const result = await runCli(["check", repo, "--local", "--json"]);
    const report = JSON.parse(result.output);

    assert.equal(result.exitCode, 1);
    assert.equal(report.runner, "local");
    assert.equal(report.steps[0].status, "passed");
    assert.equal(report.steps[1].status, "failed");
    assert.equal(report.summary.failed, 1);
    assert.equal(report.summary.skipped, 1);
  } finally {
    await removeDir(repo);
  }
});

test("--shard audits only its slice of the list", async () => {
  const one = await makeTempDir();
  const two = await makeTempDir();
  const output = await makeTempDir();

  try {
    for (const directory of [one, two]) {
      await writeFile(path.join(directory, "package.json"), "{}\n");
      await writeFile(
        path.join(directory, "README.md"),
        ["## Install", "```bash", "npm install", "```"].join("\n"),
      );
    }

    const list = path.join(output, "repos.txt");
    await writeFile(list, [one, two].join("\n"), "utf8");

    const result = await runCli([
      "audit", list, "--dry-run", "--shard", "2/2", "--out", path.join(output, "results"),
    ]);

    // The totals line also says "planned", so count only the entry lines.
    assert.equal((result.output.match(/^ {2}planned /gm) ?? []).length, 1);
    assert.ok(result.output.includes(two));
    assert.ok(!result.output.includes(`${one}\n`));
  } finally {
    await removeDir(one);
    await removeDir(two);
    await removeDir(output);
  }
});

test("a README with no setup steps is not an error", async () => {
  const repo = await makeTempDir();

  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(
      path.join(repo, "README.md"),
      "# thing\n\nA library that does one thing, described in prose.\n",
    );

    const result = await runCli(["check", repo, "--local"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /nothing to run/);
  } finally {
    await removeDir(repo);
  }
});

test("a command that does not exist is reported as unavailable, not broken", async () => {
  const repo = await makeTempDir();
  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(
      path.join(repo, "README.md"),
      ["## Setup", "```bash", "quickstart-no-such-command --x", "```"].join("\n"),
    );

    const result = await runCli(["check", repo, "--local", "--json"]);
    const report = JSON.parse(result.output);

    assert.equal(report.steps[0].status, "unavailable");
    assert.equal(report.summary.failed, 0);
    assert.equal(result.exitCode, 0);
  } finally {
    await removeDir(repo);
  }
});

test("a dry run prints the plan and executes nothing", async () => {
  const repo = await makeTempDir();
  const marker = path.join(repo, "should-not-exist");

  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(
      path.join(repo, "README.md"),
      ["## Setup", "```bash", `touch ${marker}`, "```"].join("\n"),
    );

    const result = await runCli(["check", repo, "--dry-run"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /dry run, nothing will execute/);
    await assert.rejects(access(marker));
  } finally {
    await removeDir(repo);
  }
});

test("a dry run asked for json answers in json, and still runs nothing", async () => {
  const repo = await makeTempDir();
  const marker = path.join(repo, "should-not-exist");

  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(
      path.join(repo, "README.md"),
      ["## Setup", "```bash", `touch ${marker}`, "```"].join("\n"),
    );

    const result = await runCli(["check", repo, "--dry-run", "--json"]);
    const plan = JSON.parse(result.output);

    assert.equal(result.exitCode, 0);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.repository, repo);
    assert.equal(plan.stack, "node");
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].status, "run");
    assert.deepEqual(plan.steps[0].commands, [`touch ${marker}`]);
    await assert.rejects(access(marker));
  } finally {
    await removeDir(repo);
  }
});

test("a directory without a README exits 2", async () => {
  const repo = await makeTempDir();
  try {
    const result = await runCli(["check", repo, "--local"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.output, /no README\.md/);
  } finally {
    await removeDir(repo);
  }
});

test("a flag belonging to the other command exits 2 and says which one", async () => {
  const repo = await makeTempDir();
  try {
    await writeFile(path.join(repo, "package.json"), "{}\n");
    await writeFile(
      path.join(repo, "README.md"),
      ["## Setup", "```bash", "echo hi", "```"].join("\n"),
    );

    const result = await runCli(["check", repo, "--shard", "2/4"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.output, /--shard only applies to `quickstart audit`/);
    assert.doesNotMatch(result.output, /at Object\./);
  } finally {
    await removeDir(repo);
  }
});

test("an unknown flag exits 2 with a hint instead of a stack trace", async () => {
  const result = await runCli(["--nonsense"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.output, /--help/);
  assert.doesNotMatch(result.output, /at Object\./);
});
