import assert from "node:assert/strict";
import test from "node:test";

import { planSteps, scriptFor, shellQuote, failedCommand, MARKER } from "../src/steps.js";
import { parseMarkdown } from "../src/readme.js";

function plan(markdown: string) {
  return planSteps(parseMarkdown(markdown).blocks);
}

test("runs prompted lines from a console block and ignores the output", () => {
  const steps = plan(
    [
      "```console",
      "$ npm install",
      "added 214 packages in 3s",
      "$ npm run build",
      "done",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(steps[0].commands, ["npm install", "npm run build"]);
  assert.equal(steps[0].status, "run");
});

test("an indented $ in the output is not mistaken for a command", () => {
  const steps = plan(
    ["```console", "$ npm ci", "      $ npm run db:push", "done", "```"].join("\n"),
  );

  assert.deepEqual(steps[0].commands, ["npm ci"]);
});

test("a console block with no prompts produces no step", () => {
  const steps = plan("```console\nadded 214 packages\n```");
  assert.equal(steps.length, 0);
});

test("keeps every non-empty line of a bash block", () => {
  const steps = plan("```bash\nexport FOO=1\n\nnpm ci\n```");

  assert.deepEqual(steps[0].commands, ["export FOO=1", "npm ci"]);
});

test("joins commands that continue with a backslash", () => {
  const steps = plan(
    ["```bash", "docker run \\", "  --rm \\", "  -p 3000:3000 app", "```"].join("\n"),
  );

  assert.deepEqual(steps[0].commands, ["docker run \n  --rm \n  -p 3000:3000 app"]);
});

test("ignores languages that are not shell", () => {
  const steps = plan("```ts\nconst a = 1;\n```\n\n```python\nprint(1)\n```");
  assert.equal(steps.length, 0);
});

test("skips a usage example even when the heading is not called Usage", () => {
  const steps = plan(
    ["## Preview window", "```bash", "fzf --preview 'bat {}'", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "skip");
  assert.equal(steps[0].reason, "no setup command found");
});

test("accepts a bare fence when it reads like a shell session", () => {
  const steps = plan(["```", "$ brew install ripgrep", "```"].join("\n"));

  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].commands, ["brew install ripgrep"]);
  assert.equal(steps[0].status, "run");
});

test("ignores a bare fence that is not shell", () => {
  const steps = plan(["```", "just some prose in a box", "```"].join("\n"));
  assert.equal(steps.length, 0);
});

test("runs the first install route and records the rest as alternatives", () => {
  const steps = plan(
    [
      "## On Ubuntu",
      "```bash",
      "sudo apt install bat",
      "```",
      "## On macOS",
      "```bash",
      "brew install bat",
      "```",
    ].join("\n"),
  );

  assert.equal(steps[0].status, "run");
  assert.equal(steps[1].status, "skip");
  assert.match(steps[1].reason, /another install route/);
});

test("skips blocks under a Usage heading", () => {
  const steps = plan(
    ["## Usage", "```bash", "widget --help", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "skip");
  assert.match(steps[0].reason, /not setup/);
});

test("skips commands that contain a placeholder, and says why", () => {
  const steps = plan(
    ["## Setup", "```bash", "export API_KEY=<your-key>", "npm start", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "skip");
  assert.match(steps[0].reason, /placeholder/);
});

test("an explicit annotation overrides the section heuristic", () => {
  const steps = plan(
    ["## Usage", "<!-- quickstart: run -->", "```bash", "make demo", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "run");
  assert.equal(steps[0].reason, "");
});

test("an explicit skip annotation wins over everything else", () => {
  const steps = plan(
    ["## Install", "<!-- quickstart: skip -->", "```bash", "npm ci", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "skip");
  assert.equal(steps[0].reason, "annotation says skip");
});

test("a fence marked quickstart is always included", () => {
  const steps = plan(
    ["## Usage", "```bash quickstart", "npm run seed", "```"].join("\n"),
  );

  assert.equal(steps[0].status, "run");
});

test("numbers steps in order and keeps the README line", () => {
  const steps = plan(
    ["## Install", "```bash", "npm ci", "```", "", "## Run", "```bash", "npm start", "```"].join("\n"),
  );

  assert.deepEqual(steps.map((s) => [s.index, s.line, s.section]), [
    [1, 2, "Install"],
    [2, 7, "Run"],
  ]);
});

test("scriptFor stops on the first failure and announces each command", () => {
  const script = scriptFor({
    index: 1,
    line: 3,
    section: "Install",
    language: "bash",
    commands: ["npm ci", "npm run db:push"],
    status: "run",
    reason: "",
  });

  const lines = script.split("\n");
  assert.equal(lines[0], "set -e");
  assert.match(lines[1], new RegExp(MARKER));
  assert.equal(lines[2], "npm ci");
  assert.match(lines[3], new RegExp(MARKER));
  assert.equal(lines[4], "npm run db:push");
});

test("shellQuote survives a single quote in the command", () => {
  assert.equal(shellQuote("echo 'hi'"), `'echo '\\''hi'\\'''`);
});

test("failedCommand reports the last command that started", () => {
  const output = [
    `${MARKER} npm ci`,
    "ok",
    `${MARKER} npm run db:push`,
    "DATABASE_URL is not set",
  ].join("\n");

  assert.equal(failedCommand(output), "npm run db:push");
});

test("failedCommand returns null when the markers were lost", () => {
  assert.equal(failedCommand("segmentation fault"), null);
});
