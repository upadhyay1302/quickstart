#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { HELP, UsageError, parseArguments, type Options } from "./args.js";
import {
  auditRepositories,
  describeEntry,
  formatAuditTotals,
  parseRepoList,
} from "./audit.js";
import { CheckError, NoRunnerError, VERSION, checkRepository, planRepository } from "./check.js";
import { formatJson, formatPlanJson, formatText } from "./report.js";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_CANNOT_RUN = 2;

async function main(argv: string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) return explainUsageError(error.message);
    throw error;
  }

  if (options.help) {
    console.log(HELP);
    return EXIT_OK;
  }

  if (options.command === "audit") {
    return runAudit(options);
  }

  return runCheck(options);
}

async function runCheck(options: Options): Promise<number> {
  const repository = path.resolve(options.target);

  try {
    await access(repository);
  } catch {
    console.error(`quickstart: no such directory: ${repository}`);
    return EXIT_CANNOT_RUN;
  }

  try {
    if (options.dryRun) {
      const plan = await planRepository(repository, options.image);

      // A dry run asked for JSON has to answer in JSON. Printing the readable
      // plan for it would leave the flag doing nothing, which is the thing
      // this command was just taught not to do.
      if (options.json) {
        console.log(
          formatPlanJson({
            tool: "quickstart",
            version: VERSION,
            repository,
            dryRun: true,
            stack: plan.stack,
            image: plan.image,
            steps: plan.steps,
          }),
        );
      } else {
        printPlan(repository, plan.steps, plan.stack, plan.image);
      }

      return EXIT_OK;
    }

    const report = await checkRepository(repository, {
      runner: options.runner,
      image: options.image,
      timeoutMs: options.timeoutMs,
      keepGoing: options.keepGoing,
    });

    if (options.json) {
      console.log(formatJson(report));
    } else {
      console.log(
        formatText(report, {
          colour: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
          verbose: options.verbose,
        }),
      );
    }

    return report.summary.failed + report.summary.timeout > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    return explainCheckError(error);
  }
}

async function runAudit(options: Options): Promise<number> {
  const listPath = path.resolve(options.target === "." ? "repos.txt" : options.target);

  let text: string;
  try {
    text = await readFile(listPath, "utf8");
  } catch {
    console.error(`quickstart: cannot read the repository list at ${listPath}`);
    console.error("Pass a file: quickstart audit repos.txt");
    return EXIT_CANNOT_RUN;
  }

  const sources = parseRepoList(text);
  if (sources.length === 0) {
    console.error(`quickstart: ${listPath} has no repositories in it`);
    return EXIT_CANNOT_RUN;
  }

  try {
    const summary = await auditRepositories({
      sources,
      outputDirectory: path.resolve(options.out),
      runner: options.runner,
      image: options.image,
      timeoutMs: options.timeoutMs,
      keepGoing: options.keepGoing,
      shard: options.shard,
      dryRun: options.dryRun,
      onProgress: (entry) => console.log(describeEntry(entry)),
    });

    console.log("");
    console.log(formatAuditTotals(summary));
    console.log(`results written to ${path.resolve(options.out)}`);

    return summary.totals.withFailures > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    return explainCheckError(error);
  }
}

function printPlan(
  repository: string,
  steps: Awaited<ReturnType<typeof planRepository>>["steps"],
  stack: string,
  image: string,
): void {
  console.log(`quickstart  ${repository}`);
  console.log(`stack       ${stack} → ${image}`);
  console.log("mode        dry run, nothing will execute");
  console.log("");

  if (steps.length === 0) {
    console.log("no setup steps found in README.md — nothing to run");
    return;
  }

  for (const step of steps) {
    const status = step.status === "skip" ? `skip (${step.reason})` : "run";
    console.log(`  ${String(step.index).padStart(2)}  ${step.section || "(top)"} — ${status}`);
    for (const command of step.commands) {
      console.log(`      $ ${command}`);
    }
  }
}

function explainUsageError(message: string): number {
  console.error(`quickstart: ${message}`);
  console.error("Run `quickstart --help` for usage.");
  return EXIT_CANNOT_RUN;
}

function explainCheckError(error: unknown): number {
  if (error instanceof NoRunnerError) {
    console.error(
      [
        "quickstart: Docker is not available.",
        "",
        "  Install Docker for a clean, isolated run (the mode the audit uses), or:",
        "  --local    run the commands on this machine, unsandboxed",
        "  --dry-run  print the plan without running anything",
      ].join("\n"),
    );
    return EXIT_CANNOT_RUN;
  }

  if (error instanceof CheckError) {
    console.error(`quickstart: ${error.message}`);
    return EXIT_CANNOT_RUN;
  }

  console.error(`quickstart: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT_CANNOT_RUN;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`quickstart: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = EXIT_CANNOT_RUN;
  });
