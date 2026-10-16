import { browserComposeText, browserStatus } from "@/lib/browser";
import { nowIso } from "@/lib/ids";
import { updateStore } from "@/lib/store";

export async function measureOutboxAftermath(itemId: string): Promise<void> {
  const status = await browserStatus();
  if (!status.running) return;

  const composeText = await browserComposeText();
  const composeOpen = composeText !== null;
  const draftLeft = composeText !== null && composeText.trim().length > 0;

  await updateStore((store) => {
    const item = store.outbox?.find((candidate) => candidate.id === itemId);
    if (item) item.aftermath = { at: nowIso(), composeOpen, draftLeft };
  });
}
