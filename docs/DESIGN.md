# quickstart — design notes

## The question this tool answers

> If I follow your README from a clean machine, where does it break?

Not "is your documentation well written", not "are your links alive". The only
thing measured is: **do the commands in the README still run, in order, on a
machine that has nothing but the toolchain.**

## What it is

A CLI that reads a repository's `README.md`, pulls out the shell blocks that
look like setup instructions, runs them in a clean environment, and reports
which step a new contributor would get stuck on.

It is also a measurement project. The CLI is the useful half; the other half is
running it across a few hundred popular repositories and publishing how many of
them have a broken quickstart. Anyone can clone the code. Nobody can clone the
audit afterwards.

## Non-goals

- **Not a linter.** It does not care about prose, spelling, tone or formatting.
- **Not a link checker.** Dead links are a solved, boring problem.
- **Not a sandbox for untrusted code.** Isolation exists so the run is
  *reproducible*, not so it is safe to run malware. This distinction is stated
  in the README, the `--help` output and the report.
- **Not an AI tool.** There is no model in the loop. Every verdict comes from a
  process exit code.

## Stack, and why

**TypeScript on Node 20+, no runtime dependencies.**

- `npx quickstart` is the shortest path from "read about it" to "ran it" for the
  audience this is for. A Go binary would need a release for every platform.
- The people who write the READMEs this tool reads are mostly working in
  JavaScript. A single-file, dependency-free codebase is readable to them.
- `node:test` is built in, so the tests need no framework either.
- The only dependency in the project is TypeScript itself, at build time.

Go was the other candidate and is a better language for this job in the
abstract. It loses on distribution here: `npx` beats "download the right
binary", and the tool has to be trivial for a stranger to try.

## How a README becomes a list of steps

Parsing is deliberately conservative. A false positive that runs the wrong
command is much worse than a false negative that skips a block.

1. **Find the file.** `README.md` in the repository root, any capitalisation.
   Markdown only; `README.rst` is out of scope for v1.
2. **Split it into headings and fenced code blocks.** ATX headings (`## Like
   this`). Backtick and tilde fences of any length. Each block remembers the
   heading it sits under and any annotation immediately above it.
3. **Keep shell blocks only.** `bash`, `sh`, `shell`, `zsh`, `console`,
   `shell-session`, `terminal`.
4. **In a `console` block, only prompt lines are commands.** A line starting
   with `$ ` or `> ` is a command; everything else is the output it produced and
   is ignored. This is the difference between a tool that works and one that
   tries to execute `added 214 packages in 3s`.
5. **Join continuation lines.** A trailing `\` means the next line belongs to
   the same command.
6. **Require a setup-shaped command.** A block is setup when its heading says
   so (*install*, *setup*, *getting started*, *from source*, *development*) or
   it contains a command that installs or builds something (`npm install`, `pip
   install`, `cargo build`, `go install`, `apt install`, `make`, `git clone`,
   `docker build`, …). Everything else is skipped as *no setup command found*.
   This rule was added after the first corpus run: without it `bat` planned 55
   runnable steps and `fzf` 34, almost all of them usage examples.
7. **Accept bare fences only when they read like shell.** `ripgrep` writes its
   install instructions in fences with no language at all; other projects use
   bare fences for diagrams.
8. **Pick one install route.** A README offering apt, brew, cargo and a source
   build is offering choices, not a sequence. The first install block runs and
   the rest are recorded as alternatives.
9. **Flag placeholders instead of running them.** Anything containing `<angle
   brackets>`, `YOUR_TOKEN`, `your-api-key`, `changeme` and friends becomes a
   step that is reported as *needs input* rather than executed. Running
   `export API_KEY=<your-key>` is just a guaranteed failure.
10. **Honour explicit annotations.** `<!-- quickstart: skip -->` above a block
   skips it, `<!-- quickstart: run -->` includes it, and a fence written as
   ```` ```bash quickstart ```` forces inclusion. The heuristic guesses; the
   annotation decides.

Each block becomes one step. The commands inside a step run as one shell script
with `set -e`, and a marker line is echoed before each command so a failure can
be attributed to the exact command that caused it, not just the block.

## Runs, and where they happen

Two runners, chosen automatically:

- **`docker`** — the default when the daemon is reachable. The repository is
  copied into a fresh container, `HOME` is a scratch directory, the host
  environment is not passed through, and the image is picked from the stack
  (`node:20-bookworm`, `python:3.12-bookworm`, `golang:1.22-bookworm`, …).
  This is the mode the audit uses.
- **`local`** — `--local`, for people without Docker. The repository is copied
  to a temporary directory and the commands run on the host with a scrubbed
  environment and a timeout. It is honest about what it is: a convenience, not
  a sandbox. The report says so on every run.

If neither is available, the tool still works in `--dry-run`: it prints the plan
and executes nothing. A tool that refuses to explain itself because Docker is
missing is a bad tool.

## What counts as a failure

Exit code 0 passes; anything else fails. The one exception is exit code 127,
the shell's "command not found": that is recorded as *not available here*,
because it describes the environment rather than the README.

This matters more than it looks. A README that starts with `brew install` on a
Debian image is not broken; it is being read by the wrong machine. Mixing those
two into one number would make the audit meaningless.

Repositories whose README has nothing runnable are recorded as `no-steps` and
excluded from the denominator. Counting them as healthy would inflate the
result in exactly the way this project is supposed to avoid.

## Exit codes

| code | meaning |
| ---- | ------- |
| 0 | every step passed |
| 1 | at least one step failed |
| 2 | the tool could not run: no README, bad flag, no runner |

A step that is skipped for a placeholder does not fail the run. That is a
decision, not an oversight: the README is not wrong, it just cannot be
executed unattended. The audit counts these separately.

## Output

Human-readable by default: one line per step, the failing command, and the last
few lines of its output. `--json` emits a stable schema for CI and for the audit
harness. Failures name the README line, so the report links back to the text
that lied.

## The audit

`quickstart audit` reads a list of repositories, shallow-clones each one, runs
`check` inside Docker, and writes one JSON file per repository plus a summary.
The summary is what becomes the public write-up: how many repositories break on
a clean machine, which step breaks most often, and which projects are worst.

The audit is the part that cannot be copied. The CLI takes a weekend; the audit
takes weeks of compute and produces a number nobody else has.

## Roadmap

- [x] README parsing, step planning, tests
- [x] runners (docker, local), report, CLI
- [x] `audit` harness
- [x] the corpus: 103 repositories, nine ecosystems
- [x] the planning pass: 47 of them have a runnable quickstart, see
      [`FINDINGS.md`](FINDINGS.md)
- [ ] the executed run, in CI, four shards
- [ ] the write-up and the published results
