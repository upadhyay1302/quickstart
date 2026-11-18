import { readFile } from "node:fs/promises";
import path from "node:path";

import { detectStack } from "./detect.js";
import { findReadme, parseMarkdown } from "./readme.js";
import type { Report, StepReport } from "./report.js";
import { chooseRunner } from "./runner.js";
import { failedCommand, planSteps, type Step } from "./steps.js";

/** A problem with the repository, as opposed to a problem with the tool. */
export class CheckError extends Error {}

/** Docker was required or expected and is not there. */
export class NoRunnerError extends Error {}

export type CheckOptions = {
  runner: "auto" | "docker" | "local";
  image: string | null;
  timeoutMs: number;
  keepGoing: boolean;
};

export type Plan = {
  readme: string;
  steps: Step[];
  stack: string;
  image: string;
};

/**
 * Everything that happens before a command runs: find the README, parse it,
 * decide which blocks are setup, and pick an image. `--dry-run` stops here, and
 * so does `audit` when it only wants the shape of a repository.
 */
export async function planRepository(
  repository: string,
  imageOverride: string | null,
): Promise<Plan> {
  const readme = await findReadme(repository);
  if (!readme) throw new CheckError(`no README.md in ${repository}`);

  const document = parseMarkdown(await readFile(readme, "utf8"));
  const steps = planSteps(document.blocks);

  const detection = await detectStack(repository);

  return {
    readme,
    steps,
    stack: detection.stack,
    image: imageOverride ?? detection.image,
  };
}

/**
 * The whole check: plan, run every step, and return a report. Nothing in here
 * prints, which is what lets the audit call it a few hundred times in a row.
 */
export async function checkRepository(
  repository: string,
  options: CheckOptions,
): Promise<Report> {
  const plan = await planRepository(repository, options.image);

  // A README that explains a project instead of installing it is a normal
  // README, not a broken one. Returning an empty report is honest, and it
  // avoids starting a container to run zero commands.
  if (plan.steps.length === 0) return emptyReport(repository, plan);

  const runner = await chooseRunner(options.runner, plan.image, options.timeoutMs);
  if (!runner) throw new NoRunnerError("Docker is not available");

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const reports: StepReport[] = [];

  try {
    await runner.prepare(repository);

    let stopped = false;
    for (const step of plan.steps) {
      // A skipped step is skipped for its own reasons. It is not "blocked by an
      // earlier failure", and saying so would misreport the README.
      if (step.status === "skip") {
        const needsInput = /placeholder/i.test(step.reason);
        reports.push(toReport(step, {
          status: needsInput ? "needs-input" : "skipped",
          exitCode: null,
          durationMs: 0,
          output: "",
        }));
        continue;
      }

      if (stopped) {
        reports.push(toReport(step, {
          status: "not-run",
          exitCode: null,
          durationMs: 0,
          output: "",
        }));
        continue;
      }

      const outcome = await runner.run(step);
      reports.push(toReport(step, outcome));

      if ((outcome.status === "failed" || outcome.status === "timeout") && !options.keepGoing) {
        stopped = true;
      }

      // A missing tool is not a broken README, but the steps after it usually
      // depend on it, so the run still stops here.
      if (outcome.status === "unavailable" && !options.keepGoing) {
        stopped = true;
      }
    }
  } finally {
    await runner.dispose();
  }

  return {
    tool: "quickstart",
    version: VERSION,
    repository,
    stack: plan.stack,
    image: plan.image,
    runner: runner.name,
    runnerDescription: runner.description,
    startedAt,
    durationMs: Date.now() - startedMs,
    steps: reports,
    summary: summarise(reports),
  };
}

export const VERSION = "0.1.0";

/** The report for a README with nothing to run. Empty, not failed. */
function emptyReport(repository: string, plan: Plan): Report {
  return {
    tool: "quickstart",
    version: VERSION,
    repository,
    stack: plan.stack,
    image: plan.image,
    runner: "none",
    runnerDescription: "nothing to run",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    steps: [],
    summary: summarise([]),
  };
}

function toReport(
  step: Step,
  outcome: { status: StepReport["status"]; exitCode: number | null; durationMs: number; output: string },
): StepReport {
  const failed = outcome.status === "failed" || outcome.status === "timeout";

  return {
    index: step.index,
    line: step.line,
    section: step.section,
    commands: step.commands,
    status: outcome.status,
    reason: step.reason,
    failedCommand: failed ? failedCommand(outcome.output) : null,
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    output: outcome.output,
  };
}

function summarise(steps: StepReport[]): Report["summary"] {
  const summary = {
    passed: 0,
    failed: 0,
    timeout: 0,
    unavailable: 0,
    skipped: 0,
    needsInput: 0,
    notRun: 0,
  };

  for (const step of steps) {
    switch (step.status) {
      case "passed": summary.passed++; break;
      case "failed": summary.failed++; break;
      case "timeout": summary.timeout++; break;
      case "unavailable": summary.unavailable++; break;
      case "skipped": summary.skipped++; break;
      case "needs-input": summary.needsInput++; break;
      case "not-run": summary.notRun++; break;
    }
  }

  return summary;
}

/** Absolute path for a repository, so reports are unambiguous. */
export function resolveRepository(target: string): string {
  return path.resolve(target);
}
