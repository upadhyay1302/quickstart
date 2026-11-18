import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Creates a throwaway directory for a test that needs real files. */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "quickstart-test-"));
}

export async function write(directory: string, name: string, contents: string): Promise<void> {
  await writeFile(path.join(directory, name), contents, "utf8");
}

export async function removeDir(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
