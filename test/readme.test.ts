import assert from "node:assert/strict";
import test from "node:test";

import { findReadme, parseMarkdown } from "../src/readme.js";
import { makeTempDir, removeDir, write } from "./helpers.js";

const SIMPLE = `# widget

Some prose about the widget.

## Install

\`\`\`bash
npm install widget
\`\`\`

## Usage

\`\`\`js
import widget from "widget";
\`\`\`
`;

test("collects headings and blocks, and remembers the heading above each block", () => {
  const doc = parseMarkdown(SIMPLE);

  assert.deepEqual(
    doc.headings.map((h) => `${h.level}:${h.text}`),
    ["1:widget", "2:Install", "2:Usage"],
  );

  assert.equal(doc.blocks.length, 2);
  assert.equal(doc.blocks[0].language, "bash");
  assert.equal(doc.blocks[0].section, "Install");
  assert.deepEqual(doc.blocks[0].lines, ["npm install widget"]);
  assert.equal(doc.blocks[1].language, "js");
  assert.equal(doc.blocks[1].section, "Usage");
});

test("reports 1-based line numbers for the fences", () => {
  const doc = parseMarkdown(SIMPLE);
  const [block] = doc.blocks;

  assert.equal(block.startLine, 7);
  assert.equal(block.endLine, 9);
});

test("supports tilde fences", () => {
  const doc = parseMarkdown("~~~sh\nmake install\n~~~\n");

  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].language, "sh");
  assert.deepEqual(doc.blocks[0].lines, ["make install"]);
});

test("a longer opening fence can contain a shorter one", () => {
  const doc = parseMarkdown("````md\n```bash\nnpm install\n```\n````\n");

  assert.equal(doc.blocks.length, 1);
  assert.deepEqual(doc.blocks[0].lines, ["```bash", "npm install", "```"]);
});

test("a backtick fence whose info string contains a backtick is just text", () => {
  const doc = parseMarkdown(
    ["Write a fence as ```` ```bash quickstart ```` to force it in.", "", "```bash", "make", "```"].join("\n"),
  );

  assert.equal(doc.blocks.length, 1);
  assert.deepEqual(doc.blocks[0].lines, ["make"]);
});

test("an unclosed fence runs to the end of the file", () => {
  const doc = parseMarkdown("```bash\nnpm install\nnpm run build\n");

  assert.equal(doc.blocks.length, 1);
  assert.deepEqual(doc.blocks[0].lines, ["npm install", "npm run build"]);
  assert.equal(doc.blocks[0].endLine, 3);
});

test("annotations attach to the block directly beneath them", () => {
  const doc = parseMarkdown(
    ["<!-- quickstart: skip -->", "```bash", "rm -rf build", "```"].join("\n"),
  );

  assert.deepEqual(doc.blocks[0].annotations, ["skip"]);
});

test("an annotation is dropped when prose sits between it and the block", () => {
  const doc = parseMarkdown(
    ["<!-- quickstart: skip -->", "", "Some words.", "", "```bash", "make", "```"].join("\n"),
  );

  assert.deepEqual(doc.blocks[0].annotations, []);
});

test("handles CRLF line endings", () => {
  const doc = parseMarkdown("# Title\r\n\r\n```bash\r\nnpm ci\r\n```\r\n");

  assert.equal(doc.blocks.length, 1);
  assert.deepEqual(doc.blocks[0].lines, ["npm ci"]);
});

test("a document with no headings gives blocks an empty section", () => {
  const doc = parseMarkdown("```sh\nls\n```\n");

  assert.equal(doc.blocks[0].section, "");
  assert.equal(doc.blocks[0].sectionLevel, 0);
});

test("findReadme finds the file whatever its case", async () => {
  const dir = await makeTempDir();
  try {
    await write(dir, "ReadMe.MD", "# hello\n");

    const found = await findReadme(dir);
    assert.ok(found?.endsWith("ReadMe.MD"));
  } finally {
    await removeDir(dir);
  }
});

test("findReadme returns null when there is no README", async () => {
  const dir = await makeTempDir();
  try {
    assert.equal(await findReadme(dir), null);
  } finally {
    await removeDir(dir);
  }
});
