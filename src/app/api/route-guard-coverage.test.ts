import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

function functionBody(source: string, method: string): string | null {
  const match = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*{`).exec(source);
  if (!match) return null;

  const start = source.indexOf("{", match.index);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start + 1, index);
  }
  return null;
}

describe("API route guard coverage", () => {
  it("guards every exported HTTP handler", () => {
    const apiDir = path.resolve(import.meta.dirname);
    const failures: string[] = [];

    for (const file of routeFiles(apiDir)) {
      const source = fs.readFileSync(file, "utf8");
      for (const method of METHODS) {
        const body = functionBody(source, method);
        if (body !== null && !body.includes("guardLocalRequest(")) {
          failures.push(`${path.relative(apiDir, file)}: ${method}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
