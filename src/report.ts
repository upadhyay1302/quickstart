import type { RunStatus } from "./runner.js";
import { MARKER } from "./steps.js";

export type StepReport = {
  index: number;
  line: number;
  section: string;
  commands: string[];
  status: RunStatus;
  reason: string;
  failedCommand: string | null;
  exitCode: number | null;
  durationMs: number;
  output: string;
};

export type Report = {
  tool: string;
  version: string;
  repository: string;
  stack: string;
  image: string;
  runner: string;
  runnerDescription: string;
  startedAt: string;
  durationMs: number;
  steps: StepReport[];
  summary: Record<
    "passed" | "failed" | "timeout" | "unavailable" | "skipped" | "needsInput" | "notRun",
    number
  >;
};

/**
 * The plan a dry run prints. It has the shape of a step in the report but no
 * results, because nothing ran: `status` is what would happen, not what did.
 */
export type PlanStep = {
  index: number;
  line: number;
  section: string;
  language: string;
  commands: string[];
  status: "run" | "skip";
  reason: string;
};

export type PlanReport = {
  tool: "quickstart";
  version: string;
  repository: string;
  dryRun: true;
  stack: string;
  image: string;
  steps: PlanStep[];
};

const SYMBOLS: Record<RunStatus, string> = {
  passed: "✓",
  failed: "✗",
  timeout: "!",
  unavailable: "?",
  skipped: "·",
  "needs-input": "·",
  "not-run": "·",
};

const COLOURS: Record<RunStatus, string> = {
  passed: "32",
  failed: "31",
  timeout: "33",
  unavailable: "33",
  skipped: "90",
  "needs-input": "90",
  "not-run": "90",
};

/**
 * The default output. Deliberately close to something a person would write by
 * hand: a header that says where and how it ran, one line per step, and the
 * failure inline rather than in a separate section.
 */
export function formatText(report: Report, options: { colour: boolean; verbose: boolean }): string {
  const lines: string[] = [];
  const paint = (status: RunStatus, text: string) =>
    options.colour ? `\x1b[${COLOURS[status]}m${text}\x1b[0m` : text;

  lines.push(`quickstart  ${report.repository}`);
  lines.push(`stack       ${report.stack} → ${report.image}`);
  lines.push(`runner      ${report.runnerDescription}`);
  lines.push("");

  if (report.steps.length === 0) {
    lines.push("no setup steps found in README.md — nothing to run");
    return lines.join("\n");
  }

  for (const step of report.steps) {
    const marker = paint(step.status, SYMBOLS[step.status]);
    const label = `${marker} ${String(step.index).padStart(2)}  ${step.section || "(top)"}`;
    const command = displayCommand(step);
    lines.push(`${label.padEnd(28)}${command.padEnd(58)}${formatDuration(step.durationMs)}`);

    if (step.status === "skipped" || step.status === "needs-input") {
      lines.push(`      ${dim(`skipped: ${step.reason}`, options.colour)}`);
      continue;
    }

    if (step.status === "unavailable") {
      lines.push(`      ${paint(step.status, "not available here")} · README line ${step.line}`);
      if (step.failedCommand) lines.push(`      $ ${step.failedCommand}`);
      continue;
    }

    if (step.status === "not-run") {
      lines.push(`      ${dim("not run: an earlier step failed", options.colour)}`);
      continue;
    }

    if (step.status === "failed" || step.status === "timeout") {
      const reason =
        step.status === "timeout" ? "timed out before it finished" : `exit code ${step.exitCode}`;
      lines.push(`      ${paint(step.status, reason)} · README line ${step.line}`);
      if (step.failedCommand) lines.push(`      $ ${step.failedCommand}`);
      for (const line of tail(step.output, 8)) {
        lines.push(`      ${line}`);
      }
      continue;
    }

    if (options.verbose && step.output.trim()) {
      for (const line of tail(step.output, 5)) {
        lines.push(`      ${dim(line, options.colour)}`);
      }
    }
  }

  lines.push("");
  lines.push(summaryLine(report));
  return lines.join("\n");
}

/**
 * The audit and CI read this. Field names are part of the contract: once
 * results are published, changing them breaks anyone building on the data.
 */
export function formatJson(report: Report): string {
  return JSON.stringify(report, null, 2);
}

/**
 * `--dry-run --json`, so a script can ask what a README would run without
 * having to read the human output.
 */
export function formatPlanJson(plan: PlanReport): string {
  return JSON.stringify(plan, null, 2);
}

export function summaryLine(report: Report): string {
  const { passed, failed, timeout, unavailable, skipped, needsInput, notRun } = report.summary;
  const parts = [`${passed} passed`, `${failed + timeout} failed`];

  const skippedTotal = skipped + needsInput + notRun + unavailable;
  if (skippedTotal > 0) parts.push(`${skippedTotal} skipped`);
  parts.push(formatDuration(report.durationMs));

  return parts.join(" · ");
}

function displayCommand(step: StepReport): string {
  const joined = step.commands.join(" && ").replace(/\s+/g, " ").trim();
  return joined.length > 56 ? joined.slice(0, 53) + "..." : joined;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function tail(output: string, count: number): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    // The runner announces every command with a marker so a failure can be
    // attributed. That bookkeeping is not part of what the user should read.
    .filter((line) => line !== "" && !line.includes(MARKER))
    .slice(-count);
}

function dim(text: string, colour: boolean): string {
  if (!colour) return text;
  return `\x1b[90m${text}\x1b[0m`;
}
