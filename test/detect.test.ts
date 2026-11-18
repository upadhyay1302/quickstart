import assert from "node:assert/strict";
import test from "node:test";

import { detectStack } from "../src/detect.js";
import { makeTempDir, removeDir, write } from "./helpers.js";

test("detects a node project from package.json", async () => {
  const dir = await makeTempDir();
  try {
    await write(dir, "package.json", "{}");
    const found = await detectStack(dir);

    assert.equal(found.stack, "node");
    assert.equal(found.image, "node:20-bookworm");
    assert.equal(found.evidence, "package.json");
  } finally {
    await removeDir(dir);
  }
});

test("prefers python when both pyproject.toml and package.json exist", async () => {
  const dir = await makeTempDir();
  try {
    await write(dir, "package.json", "{}");
    await write(dir, "pyproject.toml", "[project]\nname = 'x'\n");

    const found = await detectStack(dir);
    assert.equal(found.stack, "python");
    assert.equal(found.evidence, "pyproject.toml");
  } finally {
    await removeDir(dir);
  }
});

test("detects go from go.mod", async () => {
  const dir = await makeTempDir();
  try {
    await write(dir, "go.mod", "module example.com/x\n");
    assert.equal((await detectStack(dir)).stack, "go");
  } finally {
    await removeDir(dir);
  }
});

test("falls back to a plain debian image for an unknown stack", async () => {
  const dir = await makeTempDir();
  try {
    const found = await detectStack(dir);

    assert.equal(found.stack, "unknown");
    assert.equal(found.image, "debian:bookworm-slim");
  } finally {
    await removeDir(dir);
  }
});

test("reports an unreadable directory instead of throwing", async () => {
  const found = await detectStack("/definitely/not/a/real/directory");
  assert.equal(found.stack, "unknown");
});
