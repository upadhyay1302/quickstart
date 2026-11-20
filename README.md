# quickstart

**Does your README actually work?**

`quickstart` reads a repository's README, keeps the shell blocks that look like
setup instructions, runs them in order on a clean machine, and tells you which
step a new contributor would get stuck on.

![quickstart checking the example project](docs/demo.gif)

*`examples/broken-app` is broken on purpose: its README never mentions
`DATABASE_URL`, so the third setup step fails. The recording is a real run, and
`docs/demo.cast` is the terminal capture it was rendered from.*

<!-- quickstart: skip -->

```console
$ quickstart check examples/broken-app --local
quickstart  /Users/mayank/Desktop/quickstart/examples/broken-app
stack       node → node:20-bookworm
runner      local (this machine, not sandboxed)

✓  1  Setup                 cp .env.example .env                                      7ms
·  2  Setup                 mkdir -p .data                                            0ms
      skipped: another install route; the first one is used
✗  3  Setup                 npm run db:push                                           117ms
      exit code 1 · README line 22
      $ npm run db:push
      > db:push
      > node scripts/db-push.js
      DATABASE_URL is not set
      Copy .env.example to .env and fill it in.
·  4  Run                   npm run dev                                               0ms
      skipped: no setup command found
·  5  Usage                 node scripts/dev.js --help                                0ms
      skipped: section "Usage" is not setup
·  6  Deploy                DEPLOY_TOKEN=<your-token> npm run deploy                  0ms
      skipped: needs input (contains a placeholder)

1 passed · 1 failed · 4 skipped · 128ms
```

## Install

```bash
npm install
npm run build
node dist/src/main.js check /path/to/repo
```

Or, once it is published: `npx quickstart check /path/to/repo`.

## Usage

```bash
quickstart check [path]          # run the README's setup steps
quickstart check --dry-run       # show the plan, run nothing
quickstart check --json          # machine-readable output
quickstart check --local         # run on this machine instead of Docker
```

| flag | what it does |
| ---- | ------------ |
| `--local` | run on the host instead of in a container |
| `--docker` | require Docker; fail instead of falling back |
| `--image` | use a specific image instead of the detected one |
| `--timeout` | per-step limit: `90s`, `5m`, `1h` (default `5m`) |
| `--dry-run` | print the plan and execute nothing |
| `--json` | emit the full report as JSON |
| `--keep-going` | keep running after a failure |
| `--shard` | audit one slice of the list: `--shard 2/4` |
| `--verbose` | show output from passing steps too |

Exit codes: `0` everything passed, `1` something failed, `2` the tool could not
run.

## The audit

`quickstart audit` runs the same check across a list of repositories and writes
one JSON file per repository, plus a summary.

```bash
quickstart audit repos.txt --out results
```

```console
  ok       sindresorhus/got — 3 passed, 0 failed
  broken   expressjs/express — 2 passed, 1 failed, 1 skipped
  error    some/private-repo — clone failed: repository not found

3 repositories · 2 checked · 1 broken · 1 errors
results written to /Users/mayank/src/quickstart/results
```

`repos.txt` takes one repository per line — `owner/name`, a GitHub URL, or a
local path — and `#` starts a comment. [repos.example.txt](repos.example.txt)
shows the format.

The corpus in `repos.txt` is 103 repositories across nine ecosystems: npm,
PyPI, Go modules, crates.io, RubyGems, Composer, Maven, NuGet and plain C. It
is chosen for spread, not prestige — include a project and you include its
style of README.

Of those 103, 47 have a README with an executable quickstart, 45 have nothing
runnable in the README at all, and 11 cannot be read: seven document in
`README.rst`, one in `README.adoc`, one in `readme.html`, and two are too large
to clone in five minutes. Only the 47 belong in the denominator — counting a
README that keeps its setup on a website as healthy would flatter the result.

A full run takes hours, so the list can be split:

```bash
quickstart audit repos.txt --shard 1/4 --out results/shard-1
```

Shards take every *n*th entry rather than a contiguous block, so each slice
gets a mix of ecosystems instead of one slice being all of Python.

[What the first run found](docs/FINDINGS.md).

This is the half of the project that has to be earned. The CLI is a weekend; the
corpus is weeks of runs. The numbers it produces are the point.

## How it decides what to run

Only fenced blocks in `README.md`, and only blocks that are actually trying to
install or build something. A `README.md` full of examples is mostly blocks that
must *not* run.

- In a `console` block, **only lines starting with `$ ` are commands**.
  Everything else is the output they produced.
- A block is setup when its heading says so (*Install*, *Setup*, *Getting
  started*, *From source*, *Development*) **or** it contains an install-shaped
  command (`npm install`, `pip install`, `cargo build`, `go install`, `apt
  install`, `make`, `git clone`, `docker build`, …). Otherwise it is skipped as
  *no setup command found* — that is what keeps `fzf --preview` and
  `bat --list-languages` out of the run.
- Bare fences are accepted only when they read like a shell session (`$`
  prompts or an install-shaped command). `ripgrep` uses bare fences for its
  install instructions; plenty of other projects use them for diagrams.
- Blocks under *Usage*, *API*, *Reference*, *Examples*, *Output*, *FAQ*,
  *How to use* and *Troubleshooting* are skipped.
- **One install route per README.** When a README offers apt, brew, cargo and a
  source build, running all four would fail three ways on any one machine, so
  the first route runs and the others are recorded as alternatives.
- A block containing a placeholder (`<your-key>`, `YOUR_TOKEN`, `changeme`) is
  reported as **needs input** instead of being executed.
- Explicit beats inferred: an HTML comment reading `quickstart: skip` above a
  block skips it, one reading `quickstart: run` includes it, and a fence tagged
  with the word `quickstart` is always included.

Each block runs as one script with `set -e`, and a marker is printed before
every command, so a failure is attributed to the command that caused it.

## What counts as a failure

- Exit code 0 is a pass. Anything else is a failure.
- Exit code 127 means the command does not exist in this environment. That is
  reported as **not available here** and does not fail the run — it says nothing
  about the README.
- A step that times out fails, and takes its whole process tree with it.
- Skipped steps, placeholders and unavailable commands are counted separately
  from failures.
- A repository whose README has nothing runnable is recorded as `no-steps` and
  excluded from the audit denominator. Counting it as healthy would inflate the
  result.

## Isolation, honestly

- **Docker (default).** The repository is copied into a fresh container, `HOME`
  is a scratch directory, the host environment is not passed through, and the
  image comes from the detected stack (`node:20-bookworm`,
  `python:3.12-bookworm`, `golang:1.22-bookworm`, …).
- **`--local`.** The repository is copied to a temporary directory and the
  commands run on your machine with a scrubbed environment. Convenient, not
  safe. The report says so.
- Neither is a malware sandbox. `quickstart` exists to measure whether
  instructions work, not to make running untrusted code safe.

If Docker is missing, `--dry-run` still works and the plan is printed.

## What it is not

- Not a prose linter or a link checker.
- Not an AI tool. Every verdict comes from a process exit code.
- Not finished. The harness works and the corpus has been planned end to end,
  but it has not yet been executed against real repositories, so there is no
  published number. `docs/FINDINGS.md` records what the planning pass found.

## Development

```bash
npm install
npm test          # builds, then runs the suite with node:test
```

The example in `examples/broken-app` is deliberately broken and used by the
tests and by `npm run check`.

Design notes, including why this is TypeScript with no runtime dependencies,
live in [docs/DESIGN.md](docs/DESIGN.md).

## License

MIT. See [LICENSE](LICENSE).
