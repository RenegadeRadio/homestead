import { nanoid } from "nanoid";

export function nid(prefix: string) {
  return `${prefix}_${nanoid(10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "skill";
}
