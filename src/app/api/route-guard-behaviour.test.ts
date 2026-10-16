import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

function exportedMethods(source: string) {
  return METHODS.filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`).test(source),
  );
}

const apiDir = path.resolve(import.meta.dirname);
const cases = routeFiles(apiDir).flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(apiDir, file);
  return exportedMethods(source).map((method) => ({ file, relative, method }));
});

type RouteModule = Record<string, (req: Request) => Promise<Response>>;

const moduleByFile = new Map<string, RouteModule>();
await Promise.all(
  Array.from(new Set(cases.map((testCase) => testCase.file))).map(async (file) => {
    const relativeImport = path
      .relative(apiDir, file)
      .replace(/\.ts$/, "")
      .split(path.sep)
      .join("/");
    moduleByFile.set(file, (await import(`./${relativeImport}`)) as RouteModule);
  }),
);

describe("API route guard behaviour", () => {
  it.each(cases)(
    "$relative $method refuses a foreign Host",
    async ({ file, method }) => {
      const route = moduleByFile.get(file)!;
      const handler = route[method];

      expect(typeof handler).toBe("function");

      const headers: Record<string, string> = {
        Host: "attacker.example:43177",
      };
      if (method !== "GET") headers.Origin = "https://attacker.example";

      const request = new Request(
        "http://attacker.example:43177/api/route-guard-behaviour-test",
        { method, headers },
      );
      const response = await handler(request);

      expect(response.status).toBe(403);
    },
  );
});
