import { parseArgs } from "node:util";

export type Command = "check" | "audit" | "help";

export type Options = {
  command: Command;
  target: string;
  runner: "auto" | "docker" | "local";
  image: string | null;
  timeoutMs: number;
  out: string;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  keepGoing: boolean;
  /** Run only one slice of an audit list. Long corpora do not fit in one job. */
  shard: Shard | null;
  help: boolean;
};

export type Shard = { index: number; total: number };

/** Thrown for anything the user can fix by typing a different command. */
export class UsageError extends Error {}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const HELP = `quickstart — check whether a README's setup instructions work

Usage
  quickstart check [path] [options]
  quickstart audit [repos.txt] [options]

Options
  --local            run on this machine instead of in Docker
  --docker           require Docker (the default when it is available)
  --image <name>     use a specific container image
  --timeout <dur>    per-step limit, e.g. 90s, 5m, 1h (default 5m)
  --out <dir>        where audit writes results (default results)
  --dry-run          print the plan and run nothing
  --json             machine-readable output
  --keep-going       keep running after a step fails
  --shard <i>/<n>    audit only slice i of n, e.g. --shard 2/4
  --verbose          include passing command output
  -h, --help         this text

Exit codes
  0  every step passed
  1  at least one step failed
  2  the tool could not run

quickstart reads README.md, keeps the shell blocks that look like setup, and
runs them in order on a clean machine. It is not a sandbox for untrusted code:
--local runs the commands with your user's permissions.`;

/**
 * Parses the command line. Positionals are optional so `quickstart .` works as
 * a shorthand for `quickstart check .`.
 */
export function parseArguments(argv: string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        local: { type: "boolean" },
        docker: { type: "boolean" },
        image: { type: "string" },
        timeout: { type: "string" },
        out: { type: "string" },
        "dry-run": { type: "boolean" },
        json: { type: "boolean" },
        "keep-going": { type: "boolean" },
        shard: { type: "string" },
        verbose: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;

  if (values.local && values.docker) {
    throw new UsageError("--local and --docker cannot be used together");
  }

  const [first, second] = positionals;
  let command: Command = "check";
  let target = first ?? ".";

  if (first === "check" || first === "audit" || first === "help") {
    command = first;
    target = second ?? ".";
  }

  const help = Boolean(values.help) || command === "help";

  return {
    command,
    target,
    runner: values.local ? "local" : values.docker ? "docker" : "auto",
    image: values.image ?? null,
    timeoutMs: values.timeout ? parseDuration(values.timeout) : DEFAULT_TIMEOUT_MS,
    out: values.out ?? "results",
    dryRun: Boolean(values["dry-run"]),
    json: Boolean(values.json),
    verbose: Boolean(values.verbose),
    keepGoing: Boolean(values["keep-going"]),
    shard: values.shard ? parseShard(values.shard) : null,
    help,
  };
}

/**
 * Reads `2/4` as "the second of four slices". Written as a fraction because
 * that is how people describe splitting a list, and because it makes the two
 * numbers impossible to confuse.
 */
export function parseShard(value: string): Shard {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const usage = new UsageError(`not a shard: "${value}" (try 2/4)`);
  if (!match) throw usage;

  const index = Number(match[1]);
  const total = Number(match[2]);

  if (total < 1 || index < 1 || index > total) throw usage;

  return { index, total };
}

/**
 * Accepts `90s`, `5m`, `1h` and a bare number of seconds. Durations are written
 * the way people say them, not in milliseconds.
 */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());
  if (!match) {
    throw new UsageError(`not a duration: "${value}" (try 90s, 5m or 1h)`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

  return Math.round(amount * multipliers[unit]);
}
