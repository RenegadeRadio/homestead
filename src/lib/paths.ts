import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.CREW_DATA_DIR
  ? path.resolve(process.env.CREW_DATA_DIR)
  : path.join(process.cwd(), "data");
export const STORE_PATH = path.join(DATA_DIR, "store.json");
export const BROWSER_PROFILE = path.join(DATA_DIR, "browser-profile");
export const DEFAULT_COMPUTER_ROOT = path.join(DATA_DIR, "computer");

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}
