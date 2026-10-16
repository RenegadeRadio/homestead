import { browserClick, browserElements, browserStatus } from "@/lib/browser";

export interface LeftoverDeps {
  status(): Promise<{ running: boolean; url: string }>;
  elements(): Promise<{ ref: number; text: string }[]>;
  click(ref: number): Promise<unknown>;
}

const defaults: LeftoverDeps = {
  status: browserStatus,
  elements: browserElements,
  click: (ref) => browserClick({ ref }),
};

export async function closeLeftoverLinkedInConversations(
  deps: Partial<LeftoverDeps> = {}
): Promise<string[]> {
  const { status, elements, click } = { ...defaults, ...deps };
  const current = await status();
  if (!current.running) return [];

  let hostname: string;
  try {
    hostname = new URL(current.url).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) return [];

  const closed: string[] = [];
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const button = (await elements()).find((element) =>
      element.text.trim().startsWith("Close your conversation with")
    );
    if (!button) break;

    const result = await click(button.ref);
    if (
      typeof result === "object" &&
      result !== null &&
      "blocked" in result &&
      result.blocked === true
    ) break;
    closed.push(button.text.trim());
  }
  return closed;
}
