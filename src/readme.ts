import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * A code block pulled out of a README, with enough context to explain itself
 * later: which heading it sat under, which line it started on, and any
 * `<!-- quickstart: ... -->` annotation written immediately above it.
 */
export type CodeBlock = {
  language: string;
  meta: string;
  startLine: number;
  endLine: number;
  lines: string[];
  section: string;
  sectionLevel: number;
  annotations: string[];
};

export type Heading = {
  level: number;
  text: string;
  line: number;
};

export type Document = {
  headings: Heading[];
  blocks: CodeBlock[];
};

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const ANNOTATION = /^\s*<!--\s*quickstart:\s*(.*?)\s*-->\s*$/;

/**
 * Walks a markdown document once, collecting headings and fenced code blocks.
 *
 * This is not a markdown parser and does not pretend to be one. It understands
 * exactly two things: ATX headings and fenced blocks. That is all a README
 * needs, and keeping the scope small is what makes the output predictable.
 */
export function parseMarkdown(source: string): Document {
  const lines = source.split(/\r?\n/);
  const headings: Heading[] = [];
  const blocks: CodeBlock[] = [];

  let section = "";
  let sectionLevel = 0;
  let pendingAnnotations: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    const fence = FENCE_OPEN.exec(line);
    // A backtick fence cannot carry a backtick in its info string. Without this
    // rule, a sentence that shows a four-backtick fence as an example would be
    // mistaken for the start of a block.
    if (fence && !(fence[1][0] === "`" && (fence[2] ?? "").includes("`"))) {
      const marker = fence[1];
      const info = (fence[2] ?? "").trim();
      const [language = "", ...metaParts] = info.split(/\s+/);

      const body: string[] = [];
      let cursor = index + 1;
      let closed = false;

      while (cursor < lines.length) {
        if (isClosingFence(lines[cursor], marker)) {
          closed = true;
          break;
        }
        body.push(lines[cursor]);
        cursor++;
      }

      // A file that ends without a closing fence still ends with a newline,
      // and that newline is not a line of content.
      if (!closed && body.length > 0 && body[body.length - 1] === "") {
        body.pop();
      }

      blocks.push({
        language: language.toLowerCase(),
        meta: metaParts.join(" "),
        startLine: index + 1,
        endLine: closed ? cursor + 1 : index + 1 + body.length,
        lines: body,
        section,
        sectionLevel,
        annotations: pendingAnnotations,
      });

      pendingAnnotations = [];
      index = closed ? cursor + 1 : lines.length;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      section = heading[2];
      sectionLevel = heading[1].length;
      headings.push({ level: sectionLevel, text: section, line: index + 1 });
      pendingAnnotations = [];
      index++;
      continue;
    }

    const annotation = ANNOTATION.exec(line);
    if (annotation) {
      pendingAnnotations.push(annotation[1]);
      index++;
      continue;
    }

    // An annotation only applies to the block directly beneath it.
    if (line.trim() !== "") {
      pendingAnnotations = [];
    }

    index++;
  }

  return { headings, blocks };
}

/**
 * A closing fence uses the same character as the opening one and is at least as
 * long, so a block opened with four backticks can contain three.
 */
function isClosingFence(line: string, marker: string): boolean {
  const match = FENCE_CLOSE.exec(line);
  if (!match) return false;
  return match[1][0] === marker[0] && match[1].length >= marker.length;
}

const README_NAMES = ["readme.md", "readme.markdown"];

/**
 * Finds the README in a directory, whatever its capitalisation. Returns the
 * absolute path, or null when there is nothing to read.
 */
export async function findReadme(directory: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }

  const byLowercaseName = new Map(entries.map((entry) => [entry.toLowerCase(), entry]));
  for (const wanted of README_NAMES) {
    const actual = byLowercaseName.get(wanted);
    if (actual) return path.join(directory, actual);
  }

  return null;
}
