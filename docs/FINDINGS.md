# Corpus run: the planning pass

**Date:** 2026-11-18
**Corpus:** 103 repositories, nine ecosystems (`repos.txt`)
**Mode:** `quickstart audit repos.txt --dry-run --out results/planned`
**What this is not:** it is not the result. Nothing was executed. Every repository
was cloned and its README planned, to find out what the parser does with real
documentation before spending compute running install scripts. The command
writes its raw output to `results/planned/`, which git ignores; the tables below
come from the `summary.json` it produced.

## The numbers

| | |
| --- | ---: |
| repositories in the list | 103 |
| README with a runnable quickstart | 47 |
| README with nothing runnable | 45 |
| could not be read | 11 |
| fenced blocks examined | 401 |
| blocks that became steps | 71 (18%) |
| median runnable steps per repository | 1 |
| most runnable steps in one repository | 14 (`ripgrep`) |

The 47 are the denominator for anything this project publishes. The other 56
say nothing about whether READMEs work: 45 of them have no executable setup in
the README at all, and 11 could not be read. Counting those as healthy would
turn a measurement into a flattering guess.

## Where the runnable READMEs are

| ecosystem | repositories | runnable | no-steps | unreadable |
| --- | ---: | ---: | ---: | ---: |
| javascript / typescript | 27 | 17 | 9 | 1 |
| python | 25 | 9 | 9 | 7 |
| go | 16 | 11 | 5 | 0 |
| rust | 14 | 8 | 6 | 0 |
| ruby | 5 | 1 | 4 | 0 |
| php | 4 | 0 | 3 | 1 |
| java / jvm | 5 | 0 | 4 | 1 |
| c# / .net | 4 | 0 | 3 | 1 |
| c | 3 | 1 | 2 | 0 |

Java, PHP and .NET contribute thirteen repositories between them and not one
runnable setup step: their READMEs are landing pages that link to a docs site,
a Maven page or an IDE template. That is not a defect, but it does mean the
corpus's spread across ecosystems is not matched by a spread of testable
READMEs — the measured half of this project is mostly JavaScript, Go, Rust and
Python.

Python looks weaker than it is. Seven of its twenty-five READMEs are
`README.rst`, which this tool does not parse. Of the eighteen it could read,
nine have a runnable quickstart.

## The 47, and what they would run

Sorted by runnable steps, then by name. "Blocks" is every fenced block in the
README; the difference is blocks that were recognised as usage examples,
alternate install routes, or prose-dressed commands.

| repository | blocks | runnable |
| --- | ---: | ---: |
| BurntSushi/ripgrep | 31 | 14 |
| astral-sh/uv | 16 | 3 |
| expressjs/express | 10 | 3 |
| fastify/fastify | 6 | 3 |
| astral-sh/ruff | 7 | 2 |
| jestjs/jest | 7 | 2 |
| redis/redis | 26 | 2 |
| Textualize/rich | 2 | 2 |
| withastro/astro | 2 | 2 |
| axios/axios | 6 | 1 |
| caddyserver/caddy | 4 | 1 |
| chalk/chalk | 1 | 1 |
| date-fns/date-fns | 1 | 1 |
| denoland/deno | 6 | 1 |
| encode/httpx | 4 | 1 |
| eslint/eslint | 2 | 1 |
| go-redis/redis | 3 | 1 |
| gofiber/fiber | 4 | 1 |
| gorilla/mux | 3 | 1 |
| grpc/grpc-go | 3 | 1 |
| jackc/pgx | 2 | 1 |
| junegunn/fzf | 41 | 1 |
| koajs/koa | 2 | 1 |
| labstack/echo | 2 | 1 |
| lodash/lodash | 2 | 1 |
| nestjs/nest | 1 | 1 |
| npm/cli | 2 | 1 |
| nushell/nushell | 7 | 1 |
| pandas-dev/pandas | 2 | 1 |
| psf/requests | 3 | 1 |
| python/mypy | 6 | 1 |
| ramda/ramda | 1 | 1 |
| reduxjs/redux | 4 | 1 |
| sharkdp/bat | 56 | 1 |
| sharkdp/fd | 56 | 1 |
| sharkdp/hyperfine | 30 | 1 |
| sinatra/sinatra | 11 | 1 |
| sindresorhus/got | 1 | 1 |
| spf13/cobra | 2 | 1 |
| spf13/viper | 5 | 1 |
| starship/starship | 8 | 1 |
| streamlit/streamlit | 1 | 1 |
| tauri-apps/tauri | 1 | 1 |
| tiangolo/fastapi | 3 | 1 |
| traefik/traefik | 3 | 1 |
| webpack/webpack | 2 | 1 |
| yargs/yargs | 3 | 1 |

## What the pass changed

**1. "Every shell block" is the wrong rule.** The first version planned 40 steps
for `fzf` and 56 for `bat`; they were almost all usage examples — `bat
README.md`, `fzf --preview`, key bindings, preview windows. Running them would
have produced confident, meaningless failures. A block is setup only when its
heading says so or it contains an install-shaped command. `bat` went from 55
runnable steps to 1, `fd` likewise from 55 to 1, `hyperfine` from 29 to 1. Across
the corpus, 330 of 401 blocks (82%) are not setup.

**2. A language allowlist misses real READMEs.** `ripgrep` writes its install
instructions in 31 fences with no language at all, and `cobra` uses a bare fence
for `go get`. Bare fences are now accepted when they read like a shell session.
`ripgrep` went from 0 steps to 14 — it is the only repository in the corpus with
a real multi-step quickstart, because it is the only one that documents building
from source next to installing a binary.

**3. Most READMEs offer several install routes.** `bat` has fifteen, one per
platform. Running all of them fails thirteen ways on any single machine. The
tool runs the first route and records the rest as alternatives. This is the
single biggest source of false failures that never happened.

**4. One step is the norm.** 38 of the 47 runnable READMEs plan exactly one
command, and for most of them it is `npm install` or `pip install`. So the
audit's real question is narrow and unglamorous: *does the first install command
in this README work on a clean machine, today?* Almost nobody tests that, which
is why it is worth measuring.

**5. 45 READMEs have no runnable setup at all**, and only 13 of those contain any
fenced block — the block was there, it was an example. `flask`, `click`, `gin`,
`next.js`, `vite`, `svelte`, `jq` and `curl` are all in this group. A README
that explains what the project is and links to the documentation is a legitimate
choice; it just cannot be scored.

## What the unreadable 11 are

Nine of the eleven are not failures of the repository:

- seven document in `README.rst`: `django`, `scikit-learn`, `pytest`, `celery`,
  `sqlalchemy`, `tqdm`, `scrapy`
- `spring-projects/spring-boot` uses `README.adoc`
- `WordPress/WordPress` ships `readme.html`

The reader is Markdown-only, on purpose: parsing reStructuredText and AsciiDoc
well is a second project, and doing it badly would produce garbage steps. These
are recorded as errors, not as `no-steps`, because the tool genuinely does not
know what they contain.

The remaining two are `prisma/prisma` and `AvaloniaUI/Avalonia`, whose clones do
not finish in five minutes. That is a limit of the run, not of the README; a
`--depth 1` clone would fix it, at the cost of not seeing the history a
contributor would get.

## What this run cannot say

It cannot say what fraction of READMEs are broken. That number needs execution,
and execution is blocked here: there is no Docker, Podman, Colima, OrbStack or
Lima on this machine, and running a hundred projects' install scripts directly
on the host is not something this tool should do to its author.

It also cannot say a failure is the README's fault. A README that starts with
`brew install` on a Debian image is not broken; it is being read by the wrong
machine. Exit code 127 is recorded as *not available here*, separately from
failures, and any published failure rate needs a second pass in a matching
environment — macOS, and a distribution with the right package manager — before
it means anything.

## Status

Planned end to end on 2026-11-18 in about 25 minutes of local cloning, which is
why the audit splits into shards. Execution is available as a manual GitHub
Actions workflow (`.github/workflows/audit.yml`) that runs four shards, each with
Docker and a disposable machine, and uploads its results as an artifact. This
document gets a second half — the actual pass rate, the failures with their
output, and the 127 pass — once that workflow has run.
