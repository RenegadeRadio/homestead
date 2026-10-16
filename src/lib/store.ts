import fs from "node:fs/promises";
import path from "node:path";

import { createSeedStore } from "@/lib/seed";
import { DEFAULT_COMPUTER_ROOT, STORE_PATH, ensureDir } from "@/lib/paths";
import { README_UPGRADES, SKILL_BODY_UPGRADES } from "@/lib/seed-upgrades";
import type { Store } from "@/lib/types";

export const SEEDED_COMPUTER_README = README_UPGRADES[0].newText;

interface StoreState {
  cache: Store | null;
  chain: Promise<unknown>;
}

declare global {
  var __crewStore: StoreState | undefined;
}

function storeState(): StoreState {
  return (globalThis.__crewStore ??= {
    cache: null,
    chain: Promise.resolve(),
  });
}

async function seedComputer(root: string) {
  ensureDir(root);
  ensureDir(path.join(root, "briefs"));
  ensureDir(path.join(root, "drafts"));
  ensureDir(path.join(root, "research"));
  ensureDir(path.join(root, "inbox"));
  ensureDir(path.join(root, "scripts"));

  const readme = path.join(root, "README.md");
  try {
    await fs.access(readme);
  } catch {
    await fs.writeFile(readme, SEEDED_COMPUTER_README, "utf8");
  }
}

async function seedAndPersist(): Promise<Store> {
  const store = createSeedStore();
  await seedComputer(store.settings.computerRoot);
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  return store;
}

type RepairableStore = Omit<Partial<Store>, "settings"> & {
  settings?: Partial<Store["settings"]>;
};

function repairStore(parsed: unknown): Store {
  const source: RepairableStore =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as RepairableStore)
      : {};
  const repaired = { ...source } as Store;
  const arrayFields = [
    "providers",
    "bots",
    "conversations",
    "messages",
    "skills",
    "routines",
    "plugins",
    "computerLogs",
    "browseSnapshots",
    "pendingApprovals",
    "terminalSessions",
    "xReplies",
    "companyCandidates",
  ] as const;

  for (const field of arrayFields) {
    if (!Array.isArray(source[field])) {
      repaired[field] = [];
    }
  }

  repaired.settings = {
    ...createSeedStore().settings,
    ...(source.settings ?? {}),
  };
  return repaired;
}

async function readFromDisk(): Promise<Store> {
  ensureDir(path.dirname(STORE_PATH));
  let raw: string;
  try {
    raw = await fs.readFile(STORE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return seedAndPersist();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const unreadablePath = `${STORE_PATH}.unreadable-${new Date()
      .toISOString()
      .replace(/:/g, "-")}`;
    await fs.rename(STORE_PATH, unreadablePath);
    console.warn(`Unreadable store moved to ${unreadablePath}`);
    return seedAndPersist();
  }

  const store = repairStore(parsed);
  const computerRoot = store.settings.computerRoot || DEFAULT_COMPUTER_ROOT;
  await seedComputer(computerRoot);
  if (!store.skills.some((s) => s.slug === "signed-in-site")) {
    store.skills.push({
      id: "skill_signed_in",
      name: "Signed-in site",
      slug: "signed-in-site",
      body: `Work in the shared browser the way a careful person would.

1. browser_navigate to the site.
2. If login, 2FA, CAPTCHA, or a password field appears, request_takeover. Never ask for secrets in chat.
3. After the user continues, snapshot and proceed.
4. Draft in the compose box. Do not click Send/Post/Invite until the user approves.`,
      createdAt: new Date().toISOString(),
    });
  }

  for (const skill of store.skills) {
    const upgrade = SKILL_BODY_UPGRADES.find(
      (candidate) =>
        candidate.slug === skill.slug && candidate.oldBody === skill.body
    );
    if (upgrade) skill.body = upgrade.newBody();
  }

  const readmePath = path.join(computerRoot, "README.md");
  const readmeContent = await fs.readFile(readmePath, "utf8");
  const readmeUpgrade = README_UPGRADES.find(
    (upgrade) => upgrade.oldText === readmeContent
  );
  if (readmeUpgrade) {
    await fs.writeFile(readmePath, readmeUpgrade.newText, "utf8");
  }
  return store;
}

export async function getStore(): Promise<Store> {
  const state = storeState();
  if (!state.cache) state.cache = await readFromDisk();
  return state.cache;
}

export async function saveStore(store: Store) {
  storeState().cache = store;
  ensureDir(path.dirname(STORE_PATH));
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = storeState().chain.then(async () => {
    const store = await getStore();
    const result = await fn(store);
    await saveStore(store);
    return result;
  });
  storeState().chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function persistStore(): Promise<void> {
  const run = storeState().chain.then(async () => {
    const cache = storeState().cache;
    if (cache) await saveStore(cache);
  });
  storeState().chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function publicStore(store: Store): Store {
  return {
    ...store,
    providers: store.providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? "••••••••" : "",
    })),
    pendingApprovals: store.pendingApprovals.map((a) => ({
      ...a,
      checkpoint: [],
    })),
  };
}
