import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scriptFor, type Step } from "./steps.js";

export type RunStatus =
  | "passed"
  | "failed"
  | "timeout"
  /** The command does not exist in this environment, so this says nothing
   *  about the README. Exit code 127 is the shell's "command not found". */
  | "unavailable"
  | "skipped"
  | "needs-input"
  | "not-run";

export type StepOutcome = {
  status: RunStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
};

export type Runner = {
  name: "docker" | "local";
  /** One line for the report, so the reader knows what the result means. */
  description: string;
  prepare(repository: string): Promise<void>;
  run(step: Step): Promise<StepOutcome>;
  dispose(): Promise<void>;
};

/**
 * Things that must not be copied into the working directory. A clean checkout
 * is the point: a stale `node_modules` would hide exactly the failures this
 * tool hunts for, and `.git` can be enormous.
 */
const SKIP_IN_COPY = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "vendor",
  ".next",
  ".cache",
  "__pycache__",
]);

/**
 * Output is capped so one runaway `npm install` cannot fill a report file. Both
 * ends are kept and the middle is what gets dropped: the first lines say what
 * started, the last lines say what went wrong, and a failure report is worth
 * nothing without the second.
 */
const MAX_OUTPUT_CHARS = 200_000;
const HEAD_CHARS = 40_000;
const TAIL_CHARS = MAX_OUTPUT_CHARS - HEAD_CHARS;

const DEFAULT_IMAGE = "debian:bookworm-slim";

/**
 * Picks a runner. Docker is the default because the whole premise is a clean
 * machine; quietly falling back to the host would make the result a lie.
 */
export async function chooseRunner(
  preference: "auto" | "docker" | "local",
  image: string,
  timeoutMs: number,
): Promise<Runner | null> {
  if (preference === "local") return new LocalRunner(timeoutMs);

  const available = await dockerAvailable();
  if (!available) return null;

  return new DockerRunner(image, timeoutMs);
}

export async function dockerAvailable(): Promise<boolean> {
  const result = await runProcess("docker", ["version", "--format", "{{.Server.Version}}"], {
    env: process.env,
    timeoutMs: 8_000,
  });
  return result.exitCode === 0;
}

export class LocalRunner implements Runner {
  name = "local" as const;
  description = "local (this machine, not sandboxed)";

  private workspace = "";
  private repository = "";

  constructor(private readonly timeoutMs: number) {}

  async prepare(repository: string): Promise<void> {
    this.workspace = await mkdtemp(path.join(tmpdir(), "quickstart-local-"));
    this.repository = path.join(this.workspace, "repo");
    await copyRepository(repository, this.repository);
    await mkdir(path.join(this.workspace, "home"), { recursive: true });
  }

  async run(step: Step): Promise<StepOutcome> {
    // A scrubbed environment: nothing from the user's shell leaks in, so a
    // result cannot depend on a variable that happens to be exported.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: path.join(this.workspace, "home"),
      TMPDIR: path.join(this.workspace, "home"),
      CI: "1",
      LANG: "C.UTF-8",
      SHELL: "/bin/bash",
    };

    const result = await runProcess("bash", ["-lc", scriptFor(step)], {
      cwd: this.repository,
      env,
      timeoutMs: this.timeoutMs,
    });

    return toOutcome(result);
  }

  async dispose(): Promise<void> {
    if (this.workspace) await rm(this.workspace, { recursive: true, force: true });
  }
}

export class DockerRunner implements Runner {
  name = "docker" as const;
  description = "docker (fresh container, clean checkout)";

  private workspace = "";
  private repository = "";

  constructor(
    private readonly image: string,
    private readonly timeoutMs: number,
  ) {}

  async prepare(repository: string): Promise<void> {
    this.workspace = await mkdtemp(path.join(tmpdir(), "quickstart-docker-"));
    this.repository = path.join(this.workspace, "repo");
    await copyRepository(repository, this.repository);
  }

  async run(step: Step): Promise<StepOutcome> {
    const result = await runProcess(
      "docker",
      dockerRunArgs(this.repository, this.image, scriptFor(step)),
      { env: process.env, timeoutMs: this.timeoutMs },
    );

    return toOutcome(result);
  }

  async dispose(): Promise<void> {
    if (this.workspace) await rm(this.workspace, { recursive: true, force: true });
  }
}

export type ProcessResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
};

/**
 * Runs a process, merges its output, and enforces a timeout. The child is
 * detached so a hung `npm install` can take its own children down with it
 * instead of leaving them behind.
 */
export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let head = "";
    let tail = "";
    let omitted = 0;
    let timedOut = false;
    let settled = false;

    // The head fills first, then everything else goes to the tail, which is
    // trimmed from the front so the most recent output always survives.
    const append = (chunk: Buffer) => {
      let text = chunk.toString("utf8");

      if (head.length < HEAD_CHARS) {
        const room = HEAD_CHARS - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
        if (text === "") return;
      }

      tail += text;
      if (tail.length > TAIL_CHARS) {
        const dropped = tail.length - TAIL_CHARS;
        omitted += dropped;
        tail = tail.slice(dropped);
      }
    };

    const collected = () => {
      if (omitted === 0) return head + tail;
      return `${head}\n[${omitted} characters omitted]\n${tail}`;
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, options.timeoutMs)
        : null;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode,
        output: collected(),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

function toOutcome(result: ProcessResult): StepOutcome {
  if (result.timedOut) {
    return {
      status: "timeout",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: result.output,
    };
  }

  if (result.exitCode === 127) {
    return {
      status: "unavailable",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output: result.output,
    };
  }

  return {
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: result.output,
  };
}

/**
 * Copies the parts of a repository a new contributor would have after cloning.
 * Build output and installed dependencies are excluded on purpose.
 */
export async function copyRepository(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    filter: (source) => !SKIP_IN_COPY.has(path.basename(source)),
  });
}

export { DEFAULT_IMAGE };

/**
 * The docker command line, separated out so it can be tested without a daemon.
 * The container gets the copied repository, a scratch HOME and nothing else
 * from the machine it is running on.
 */
export function dockerRunArgs(repository: string, image: string, script: string): string[] {
  return [
    "run",
    "--rm",
    "--init",
    "--volume",
    `${repository}:/work`,
    "--workdir",
    "/work",
    "--env",
    "CI=1",
    "--env",
    "HOME=/tmp",
    "--env",
    "DEBIAN_FRONTEND=noninteractive",
    image,
    "bash",
    "-lc",
    script,
  ];
}
