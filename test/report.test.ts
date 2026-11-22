import assert from "node:assert/strict";
import test from "node:test";

import { formatJson, formatPlanJson, formatText, summaryLine, type Report } from "../src/report.js";

function report(): Report {
  return {
    tool: "quickstart",
    version: "0.1.0",
    repository: "/tmp/app",
    stack: "node",
    image: "node:20-bookworm",
    runner: "local",
    runnerDescription: "local (this machine, not sandboxed)",
    startedAt: "2026-11-17T12:00:00.000Z",
    durationMs: 2_400,
    steps: [
      {
        index: 1,
        line: 6,
        section: "Setup",
        commands: ["cp .env.example .env"],
        status: "passed",
        reason: "",
        failedCommand: null,
        exitCode: 0,
        durationMs: 12,
        output: "",
      },
      {
        index: 2,
        line: 12,
        section: "Setup",
        commands: ["npm run db:push"],
        status: "failed",
        reason: "",
        failedCommand: "npm run db:push",
        exitCode: 1,
        durationMs: 320,
        output: "DATABASE_URL is not set",
      },
      {
        index: 3,
        line: 20,
        section: "Usage",
        commands: ["app --help"],
        status: "skipped",
        reason: 'section "Usage" is not setup',
        failedCommand: null,
        exitCode: null,
        durationMs: 0,
        output: "",
      },
    ],
    summary: { passed: 1, failed: 1, timeout: 0, unavailable: 0, skipped: 1, needsInput: 0, notRun: 0 },
  };
}

test("the text report names the step, the failing command and its output", () => {
  const text = formatText(report(), { colour: false, verbose: false });

  assert.match(text, /quickstart {2}\/tmp\/app/);
  assert.match(text, /node → node:20-bookworm/);
  assert.match(text, /✓\s+1\s+Setup/);
  assert.match(text, /✗\s+2\s+Setup/);
  assert.match(text, /\$ npm run db:push/);
  assert.match(text, /DATABASE_URL is not set/);
  assert.match(text, /skipped: section "Usage" is not setup/);
});

test("the summary counts failures and skips separately", () => {
  assert.equal(summaryLine(report()), "1 passed · 1 failed · 1 skipped · 2.4s");
});

test("the json plan says what would run and why the rest is skipped", () => {
  const parsed = JSON.parse(
    formatPlanJson({
      tool: "quickstart",
      version: "0.1.0",
      repository: "/tmp/app",
      dryRun: true,
      stack: "node",
      image: "node:20-bookworm",
      steps: [
        {
          index: 1,
          line: 6,
          section: "Setup",
          language: "bash",
          commands: ["npm install"],
          status: "run",
          reason: "",
        },
        {
          index: 2,
          line: 12,
          section: "Usage",
          language: "bash",
          commands: ["app --help"],
          status: "skip",
          reason: 'section "Usage" is not setup',
        },
      ],
    }),
  );

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.steps[0].status, "run");
  assert.equal(parsed.steps[1].status, "skip");
  assert.equal(parsed.steps[1].reason, 'section "Usage" is not setup');
});

test("the json report is stable and parseable", () => {
  const parsed = JSON.parse(formatJson(report()));

  assert.equal(parsed.steps[1].status, "failed");
  assert.equal(parsed.steps[1].failedCommand, "npm run db:push");
  assert.equal(parsed.summary.failed, 1);
});
