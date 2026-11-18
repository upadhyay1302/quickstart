# broken-app

A small example used by quickstart's own demos and tests. It is deliberately
broken: one setup step fails on a machine that has just cloned it.

## Setup

Copy the environment file:

```bash
cp .env.example .env
```

Create the local data directory:

```bash
mkdir -p .data
```

Push the schema:

```bash
npm run db:push
```

## Run

```bash
npm run dev
```

## Usage

```bash
node scripts/dev.js --help
```

## Deploy

```bash
DEPLOY_TOKEN=<your-token> npm run deploy
```
