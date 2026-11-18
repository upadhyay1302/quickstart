import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CheckError, NoRunnerError, checkRepository, planRepository, VERSION } from "./check.js";
import type { Report } from "./report.js";
import { runProcess } from "./runner.js";

export type Planned = {
  steps: number;
  runnable: number;
  skipped: number;
  sections: string[];
};

export type AuditEntry = {
  source: string;
  /** `no-steps` means the README has nothing executable to check. Those
   *  repositories are excluded from the denominator rather than counted as
   *  healthy: pretending a README with no instructions passed is a lie. */
  status: "checked" | "planned" | "no-steps" | "error";
  report: Report | null;
  /** Present when the audit ran with --dry-run: what would run, not what did. */
  planned: Planned | null;
  error: string | null;
};

export type AuditSummary = {
  tool: string;
  version: string;
  generatedAt: string;
  dryRun: boolean;
  totals: {
    repositories: number;
    checked: number;
    planned: number;
    noSteps: number;
    withFailures: number;
    errors: number;
    stepsRun: number;
  };
  entries: AuditEntry[];
};

export type AuditOptions = {
  sources: string[];
  outputDirectory: string;
  runner: "auto" | "docker" | "local";
  image: string | null;
  timeoutMs: number;
  keepGoing: boolean;
  /** Audit only one slice of `sources`, for splitting a corpus across jobs. */
  shard?: { index: number; total: number } | null;
  /** Plan each repository without executing anything. Safe without Docker. */
  dryRun?: boolean;
  onProgress?: (entry: AuditEntry) => void;
};

/**
 * Reads a repos file: one repository per line, `#` starts a comment. Lines can
 * be a GitHub URL, an `owner/name` shorthand, or a path on disk. Local paths
 * are what the tests use, and they are also useful for auditing your own
 * projects without cloning anything.
 */
export function parseRepoList(text: string): string[] {
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line) seen.add(line);
  }

  return [...seen];
}

/**
 * Takes every `total`th entry, offset by the shard index. Interleaved rather
 * than chunked so that each slice gets a similar mix of ecosystems instead of
 * one slice being all of Python.
 */
export function sliceForShard<T>(
  sources: T[],
  shard: { index: number; total: number },
): T[] {
  return sources.filter((_, position) => position % shard.total === shard.index - 1);
}

/**
 * Checks every repository in the list and writes one JSON file per repository
 * plus a summary. A repository that cannot be cloned or read is recorded as an
 * error, not allowed to stop the run: a corpus is more useful with holes than
 * with a crash.
 */
export async function auditRepositories(options: AuditOptions): Promise<AuditSummary> {
  await mkdir(options.outputDirectory, { recursive: true });

  const entries: AuditEntry[] = [];
  const workspace = await mkdtemp(path.join(tmpdir(), "quickstart-audit-"));
  const sources = options.shard ? sliceForShard(options.sources, options.shard) : options.sources;

  try {
    for (const source of sources) {
      const entry = await auditOne(source, workspace, options);
      entries.push(entry);
      options.onProgress?.(entry);

      await writeFile(
        path.join(options.outputDirectory, `${slug(source)}.json`),
        JSON.stringify(entry, null, 2) + "\n",
        "utf8",
      );
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  const summary: AuditSummary = {
    tool: "quickstart",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    totals: {
      repositories: entries.length,
      checked: entries.filter((entry) => entry.status === "checked").length,
      planned: entries.filter((entry) => entry.status === "planned").length,
      noSteps: entries.filter((entry) => entry.status === "no-steps").length,
      withFailures: entries.filter((entry) => (entry.report?.summary.failed ?? 0) > 0).length,
      errors: entries.filter((entry) => entry.status === "error").length,
      stepsRun: entries.reduce(
        (total, entry) => total + (entry.report?.summary.passed ?? 0),
        0,
      ),
    },
    entries,
  };

  await writeFile(
    path.join(options.outputDirectory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    "utf8",
  );

  return summary;
}

async function auditOne(
  source: string,
  workspace: string,
  options: AuditOptions,
): Promise<AuditEntry> {
  let repository: string;
  let cleanup: (() => Promise<void>) | null = null;

  try {
    if (await isDirectory(source)) {
      repository = path.resolve(source);
    } else {
      repository = path.join(workspace, slug(source));
      const clone = await runProcess(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--single-branch",
          "--no-tags",
          "--quiet",
          remoteFor(source),
          repository,
        ],
        // A repository big enough to need more than five minutes to clone is
        // still worth auditing; the checkout is shallow, so this is generous.
        { env: process.env, timeoutMs: 300_000 },
      );

      if (clone.exitCode !== 0) {
        const detail = clone.timedOut
          ? "git clone timed out after 5 minutes"
          : firstLine(clone.output) || `git exited with code ${clone.exitCode} and printed nothing`;

        return {
          source,
          status: "error",
          report: null,
          planned: null,
          error: `clone failed: ${detail}`,
        };
      }

      cleanup = async () => {
        await rm(repository, { recursive: true, force: true });
      };
    }

    if (options.dryRun) {
      const plan = await planRepository(repository, options.image);
      const runnable = plan.steps.filter((step) => step.status === "run").length;
      const sections = [...new Set(plan.steps.map((step) => step.section).filter(Boolean))];

      return {
        source,
        // Nothing *runnable* is the same verdict as nothing at all: a README
        // whose only blocks are usage examples cannot be checked.
        status: runnable === 0 ? "no-steps" : "planned",
        report: null,
        planned: {
          steps: plan.steps.length,
          runnable,
          skipped: plan.steps.length - runnable,
          sections,
        },
        error: null,
      };
    }

    const report = await checkRepository(repository, {
      runner: options.runner,
      image: options.image,
      timeoutMs: options.timeoutMs,
      keepGoing: options.keepGoing,
    });

    const executed =
      report.summary.passed +
      report.summary.failed +
      report.summary.timeout +
      report.summary.unavailable;

    return {
      source,
      status: executed === 0 ? "no-steps" : "checked",
      report,
      planned: null,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof CheckError || error instanceof NoRunnerError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    return { source, status: "error", report: null, planned: null, error: message };
  } finally {
    if (cleanup) await cleanup();
  }
}

/** Turns `owner/name` into a URL, and leaves anything else alone. */
function remoteFor(source: string): string {
  if (/^(https?:\/\/|git@)/.test(source)) return source;
  return `https://github.com/${source}.git`;
}

/**
 * A filename that cannot escape the output directory. A local path becomes its
 * final directory name, because `results/Users__mayank__src__app.json` is not a
 * filename anyone wants to read.
 */
export function slug(source: string): string {
  const remote = source.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const name = source.startsWith("/") || source.startsWith(".") ? path.basename(remote) : remote;

  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "__")
      .replace(/^_{2,}|_{2,}$/g, "")
      .slice(0, 120) || "repository"
  );
}

async function isDirectory(target: string): Promise<boolean> {
  if (!target.startsWith("/") && !target.startsWith(".")) return false;
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
}

/** One line per repository, printed as the audit moves through the list. */
export function describeEntry(entry: AuditEntry): string {
  if (entry.status === "error") {
    return `  error    ${entry.source} — ${entry.error ?? "unknown error"}`;
  }

  if (entry.status === "no-steps") {
    return `  no-steps ${entry.source} — the README has nothing runnable`;
  }

  if (entry.status === "planned" && entry.planned) {
    const { steps, runnable, skipped } = entry.planned;
    return `  planned  ${entry.source} — ${steps} steps, ${runnable} runnable, ${skipped} skipped`;
  }

  const { passed, failed, skipped, needsInput } = entry.report!.summary;
  const skippedTotal = skipped + needsInput;
  const verdict = failed > 0 ? "broken" : "ok";
  const detail = `${passed} passed, ${failed} failed${skippedTotal ? `, ${skippedTotal} skipped` : ""}`;

  return `  ${verdict.padEnd(8)} ${entry.source} — ${detail}`;
}

/** The last line of an audit. */
export function formatAuditTotals(summary: AuditSummary): string {
  const { repositories, checked, withFailures, errors } = summary.totals;

  const parts = [plural(repositories, "repository", "repositories")];
  if (checked > 0) parts.push(`${checked} checked`);
  if (summary.totals.planned > 0) parts.push(`${summary.totals.planned} planned`);
  if (summary.totals.noSteps > 0) parts.push(`${summary.totals.noSteps} with nothing to run`);
  if (checked > 0) parts.push(`${withFailures} broken`);
  parts.push(plural(errors, "error", "errors"));

  return parts.join(" · ");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export async function readRepoList(file: string): Promise<string[]> {
  return parseRepoList(await readFile(file, "utf8"));
}
