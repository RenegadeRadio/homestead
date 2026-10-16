import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_COMPUTER_ROOT } from "@/lib/paths";
import { getStore } from "@/lib/store";
import type { FileNode } from "@/lib/types";

export class ComputerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerError";
  }
}

export async function computerRoot() {
  const store = await getStore();
  return store.settings.computerRoot || DEFAULT_COMPUTER_ROOT;
}

export async function resolveInComputer(rel = ".") {
  const root = path.resolve(await computerRoot());
  const target = path.resolve(root, rel || ".");
  const relToRoot = path.relative(root, target);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new ComputerError("Path is outside the shared computer.");
  }
  return { root, target, rel: relToRoot === "" ? "." : relToRoot.split(path.sep).join("/") };
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  path?: string;
  regex?: boolean;
  ignoreCase?: boolean;
  maxMatches?: number;
}

export async function searchComputerFiles(
  query: string,
  options: SearchOptions = {}
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const {
    path: rel = ".",
    regex = false,
    ignoreCase = false,
    maxMatches = 100,
  } = options;
  const { target, rel: resolvedRel } = await resolveInComputer(rel);
  const startRel = resolvedRel === "." ? "" : resolvedRel;
  let pattern: RegExp | undefined;
  if (regex) {
    try {
      pattern = new RegExp(query, ignoreCase ? "i" : "");
    } catch {
      throw new ComputerError("Invalid search pattern.");
    }
  }
  const literal = ignoreCase ? query.toLowerCase() : query;
  if (startRel.split("/").some((part) => part === "node_modules" || part === ".git")) {
    return { matches: [], truncated: false };
  }
  const matches: SearchMatch[] = [];
  let truncated = false;

  const lineMatches = (line: string) =>
    pattern ? pattern.test(line) : (ignoreCase ? line.toLowerCase() : line).includes(literal);

  const searchFile = async (abs: string, fileRel: string) => {
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return;
    }
    if (stat.size > 1_000_000) return;
    let buffer;
    try {
      buffer = await fs.readFile(abs);
    } catch {
      return;
    }
    if (buffer.subarray(0, 8192).includes(0)) return;
    const lines = buffer.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!lineMatches(line)) continue;
      if (matches.length >= maxMatches) {
        truncated = true;
        return;
      }
      matches.push({ path: fileRel, line: index + 1, text: line.trim().slice(0, 200) });
    }
  };

  const walk = async (abs: string, currentRel: string) => {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      const childRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        await searchFile(childAbs, childRel);
      }
    }
  };

  let startStat;
  try {
    startStat = await fs.lstat(target);
  } catch {
    return { matches, truncated };
  }
  if (startStat.isSymbolicLink()) return { matches, truncated };
  if (startStat.isDirectory()) await walk(target, startRel);
  else if (startStat.isFile()) await searchFile(target, startRel);
  return { matches, truncated };
}

export type { FileNode };

export async function listTree(rel = ".", depth = 4): Promise<FileNode[]> {
  const { target } = await resolveInComputer(rel);
  return readDir(target, rel === "." ? "" : rel, depth);
}

async function readDir(abs: string, rel: string, depth: number): Promise<FileNode[]> {
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childAbs = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel,
        type: "dir",
        children: depth > 0 ? await readDir(childAbs, childRel, depth - 1) : [],
      });
    } else {
      const stat = await fs.stat(childAbs);
      nodes.push({ name: entry.name, path: childRel, type: "file", size: stat.size });
    }
  }
  return nodes;
}

export async function readComputerFile(rel: string, max = 80_000) {
  const { target } = await resolveInComputer(rel);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    throw new ComputerError("That path is a directory.");
  }
  const buf = await fs.readFile(target);
  if (buf.length > max) {
    return `${buf.subarray(0, max).toString("utf8")}\n\n[truncated at ${max} bytes]`;
  }
  return buf.toString("utf8");
}

export async function writeComputerFile(rel: string, content: string) {
  const { target, rel: safe } = await resolveInComputer(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let existed = true;
  try {
    await fs.access(target);
  } catch {
    existed = false;
  }
  await fs.writeFile(target, content, "utf8");
  return { path: safe, action: existed ? ("updated" as const) : ("created" as const) };
}

export async function runCommand(command: string, timeoutMs = 25_000) {
  const root = await computerRoot();
  const shell = process.platform === "win32" ? "cmd.exe" : "bash";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd: root,
      env: {
        ...process.env,
        PWD: root,
        npm_config_prefix: "",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ComputerError(`Command timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 60_000) stdout = stdout.slice(-60_000);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 60_000) stderr = stderr.slice(-60_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
