import type { CodeBlock } from "./readme.js";

/**
 * One runnable (or knowingly skipped) unit, always one fenced block.
 *
 * Blocks are the unit because commands inside a block usually depend on each
 * other — `cd` in line one, `npm install` in line two — and splitting them apart
 * would break that without making the report any clearer.
 */
export type Step = {
  index: number;
  line: number;
  section: string;
  language: string;
  commands: string[];
  status: "run" | "skip";
  reason: string;
};

/** Printed before each command so a failure can be blamed on the right line. */
export const MARKER = "::quickstart::";

const SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "shell-session",
  "terminal",
]);

// Sections that show how to *use* the project rather than how to install it.
const NON_SETUP_SECTIONS =
  /^(usage|api|reference|examples?|output|faq|troubleshoot(ing)?|screenshots?|how to use|commands?|options?)\b/i;

// Sections that are about getting the project onto a machine.
const SETUP_SECTIONS =
  /^(install(ation|ing)?|setup|set[- ]?up|getting started|quick ?start|build(ing)?|from source|development|developing|compil(e|ing)|prerequisites?)\b/i;

// A prompt sits at the start of the line or close to it. Deeply indented `$`
// lines are output from a tool that happens to print commands, not commands.
const PROMPT = /^ {0,2}\$\s+(.*)$/;

/**
 * The commands that mean "this block is trying to install or build something".
 * Everything else — `bat --list-languages`, `fzf --preview`, a key binding —
 * belongs to a usage example, and running it would invent failures.
 */
const SETUP_COMMAND = new RegExp(
  [
    String.raw`^(?:sudo|doas)\s+(?:apt|apt-get|apk|dnf|yum|pacman|zypper|snap)\s+(?:install|add)`,
    String.raw`^(?:apt|apt-get|apk|dnf|yum|pacman|zypper|snap)\s+(?:install|add)`,
    String.raw`^brew\s+(?:install|tap)`,
    String.raw`^(?:choco|scoop|winget|port)\s+install`,
    String.raw`^(?:npm|pnpm|yarn|bun)\s+(?:install|ci|i|add|link|dedupe)`,
    String.raw`^pip3?\s+install`,
    String.raw`^python3?\s+-m\s+(?:pip|venv|ensurepip)`,
    String.raw`^(?:uv|poetry|pipx)\s+(?:sync|install|add)`,
    String.raw`^cargo\s+(?:install|build|fetch)`,
    String.raw`^go\s+(?:install|build|get|mod)`,
    String.raw`^(?:make|cmake|meson|ninja|bazel)\b`,
    String.raw`^git\s+(?:clone|submodule)`,
    String.raw`^(?:cp|mv)\s+\.env`,
    String.raw`^docker\s+(?:build|compose|run|pull)`,
    String.raw`^(?:bundle|gem|composer|mix|stack|cabal)\s+(?:install|update|deps|setup)`,
    String.raw`^(?:curl|wget)\b.*\|\s*(?:sh|bash)\b`,
    String.raw`^(?:nix|nix-shell|rustup|asdf|mise|nvm|pyenv|sdk)\b`,
    String.raw`^mkdir\s`,
    String.raw`^\./configure\b`,
  ].join("|"),
  "i",
);

/**
 * Placeholders are the single biggest source of false failures. A README that
 * says `export API_KEY=<your-key>` is not broken, it is waiting for a human.
 * These are reported as skipped with a reason instead of being executed.
 */
const PLACEHOLDER =
  /(<[a-z][a-z0-9 _-]*>|YOUR_[A-Z0-9_]+|your[-_](api[-_]?key|token|secret|username)|changeme|sk-xxx|\byour-key\b)/i;

/**
 * Turns parsed blocks into an ordered plan. Every shell block becomes a step,
 * but a step can be marked `skip` with a reason, and skipped steps are still
 * shown so the reader can see what was deliberately left out.
 */
export function planSteps(blocks: CodeBlock[]): Step[] {
  const steps: Step[] = [];
  let installRouteTaken = false;

  for (const block of blocks) {
    const commands = commandsFrom(block);
    if (commands.length === 0) continue;

    // Bare fences are common (`ripgrep` uses them almost exclusively), but a
    // bare fence is just as likely to be a diagram or a config file. Accept it
    // only when it reads like a shell session.
    if (!SHELL_LANGUAGES.has(block.language) && !looksLikeShell(block, commands)) {
      continue;
    }

    const explicit = annotationCommand(block);
    const installs = commands.some((command) => SETUP_COMMAND.test(command));
    const reason = skipReason(block, commands, explicit, installs, installRouteTaken);

    if (!reason && installs) installRouteTaken = true;

    steps.push({
      index: steps.length + 1,
      line: block.startLine,
      section: block.section,
      language: block.language,
      commands,
      status: reason ? "skip" : "run",
      reason,
    });
  }

  return steps;
}

/**
 * The shell script for a step: stop on the first failure, and announce each
 * command before running it.
 */
export function scriptFor(step: Step): string {
  const lines = ["set -e"];
  for (const command of step.commands) {
    lines.push(`printf '\\n${MARKER} %s\\n' ${shellQuote(command)}`);
    lines.push(command);
  }
  return lines.join("\n") + "\n";
}

/**
 * The command that was running when the script stopped, if the output kept the
 * markers. Falls back to null so the caller can degrade to "some command in
 * this block failed".
 */
export function failedCommand(output: string): string | null {
  let current: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf(MARKER);
    if (at !== -1) current = line.slice(at + MARKER.length).trim();
  }
  return current;
}

function looksLikeShell(block: CodeBlock, commands: string[]): boolean {
  return (
    block.lines.some((line) => PROMPT.test(line)) ||
    commands.some((command) => SETUP_COMMAND.test(command))
  );
}

function commandsFrom(block: CodeBlock): string[] {
  const isConsole = block.language === "console" || block.language === "shell-session";

  if (isConsole) {
    // Only prompted lines are commands. Everything else in a console block is
    // the output those commands produced.
    const prompted = block.lines
      .map((line) => PROMPT.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]);
    return joinContinuations(prompted);
  }

  // Even a `bash` block sometimes shows a prompt. Strip it rather than trying
  // to execute `$ brew install bat`, which would fail for the wrong reason.
  const lines = block.lines
    .filter((line) => line.trim() !== "")
    .map((line) => PROMPT.exec(line)?.[1] ?? line);

  return joinContinuations(lines);
}

/**
 * A trailing backslash means the command continues on the next line. They have
 * to run as one shell invocation, so they are joined before anything else looks
 * at them.
 */
function joinContinuations(lines: string[]): string[] {
  const commands: string[] = [];
  let current = "";

  for (const line of lines) {
    const continues = line.trimEnd().endsWith("\\");
    current += (current ? "\n" : "") + (continues ? line.trimEnd().slice(0, -1) : line);
    if (!continues) {
      commands.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) commands.push(current.trim());
  return commands;
}

function annotationCommand(block: CodeBlock): string | null {
  for (const annotation of block.annotations) {
    const word = annotation.trim().toLowerCase().split(/\s+/)[0];
    if (word === "skip" || word === "run") return word;
  }

  // A fence written as ```bash quickstart forces the block in, which is useful
  // for setup steps that live under a heading the heuristics would skip.
  if (block.meta.toLowerCase().split(/\s+/).includes("quickstart")) return "run";

  return null;
}

function skipReason(
  block: CodeBlock,
  commands: string[],
  explicit: string | null,
  installs: boolean,
  installRouteTaken: boolean,
): string {
  if (explicit === "skip") return "annotation says skip";
  if (explicit === "run") return "";

  if (NON_SETUP_SECTIONS.test(block.section)) {
    return `section "${block.section}" is not setup`;
  }

  if (block.lines.some((line) => PLACEHOLDER.test(line))) {
    return "needs input (contains a placeholder)";
  }

  // A README that offers apt, brew, cargo and a source build is offering
  // choices, not a sequence. Running all of them would fail four ways on any
  // one machine, so the first route wins and the rest are recorded as
  // alternatives.
  if (installs && installRouteTaken) {
    return "another install route; the first one is used";
  }

  if (!isSetup(block, commands, installs)) {
    return "no setup command found";
  }

  return "";
}

function isSetup(block: CodeBlock, commands: string[], installs: boolean): boolean {
  if (SETUP_SECTIONS.test(block.section)) return true;
  if (installs) return true;
  return commands.some((command) => SETUP_COMMAND.test(command));
}

/** Single-quotes a string for POSIX sh, including embedded quotes. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
