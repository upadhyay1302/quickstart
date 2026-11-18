import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * The stack decides which container image a run starts from. Getting this
 * wrong is the difference between "npm: command not found" and a real answer,
 * so the signals are explicit and ordered by a stated priority.
 */
export type Stack = "node" | "python" | "go" | "rust" | "ruby" | "php" | "unknown";

export type Detection = {
  stack: Stack;
  image: string;
  evidence: string;
};

type Rule = {
  stack: Stack;
  image: string;
  files: string[];
  /** Lower wins. See the note on ordering below. */
  priority: number;
};

/**
 * `package.json` is deliberately last. It shows up in Python and Go projects
 * for docs tooling, editor extensions and git hooks, so it is the weakest
 * signal of the set. A real `pyproject.toml` tells you more about how to run a
 * repository than a `package.json` sitting next to it.
 */
const RULES: Rule[] = [
  { stack: "python", image: "python:3.12-bookworm", files: ["pyproject.toml", "requirements.txt"], priority: 10 },
  { stack: "go", image: "golang:1.22-bookworm", files: ["go.mod"], priority: 20 },
  { stack: "rust", image: "rust:1-bookworm", files: ["Cargo.toml"], priority: 30 },
  { stack: "ruby", image: "ruby:3.3-bookworm", files: ["Gemfile"], priority: 40 },
  { stack: "php", image: "php:8.3-cli-bookworm", files: ["composer.json"], priority: 50 },
  { stack: "node", image: "node:20-bookworm", files: ["package.json"], priority: 60 },
];

const FALLBACK_IMAGE = "debian:bookworm-slim";

/**
 * Finds the strongest marker file present in the directory and maps it to an
 * image. Returns the evidence so the report can explain the choice instead of
 * silently picking an image.
 */
export async function detectStack(directory: string): Promise<Detection> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return { stack: "unknown", image: FALLBACK_IMAGE, evidence: "directory cannot be read" };
  }

  const present = new Set(entries);
  const ordered = [...RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    const hit = rule.files.find((file) => present.has(file));
    if (hit) {
      return { stack: rule.stack, image: rule.image, evidence: hit };
    }
  }

  return { stack: "unknown", image: FALLBACK_IMAGE, evidence: "no marker file found" };
}
