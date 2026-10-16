import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  buildApprovalCard,
  evaluateUpdate,
  resolveBridgeConfig,
  selectNewApprovals,
} from "../src/lib/approval-bridge.ts";

const APPROVAL_POLL_MS = 2_000;
const TELEGRAM_POLL_SECONDS = 25;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readBootstrap(fetchFn, crewBaseUrl) {
  const response = await fetchFn(`${crewBaseUrl}/api/bootstrap`);
  if (!response.ok) throw new Error(`Homestead bootstrap returned status ${response.status}.`);
  const body = await response.json();
  return body.store;
}

async function telegramRequest(fetchFn, token, method, body) {
  const response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} returned status ${response.status}.`);
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method} failed.`);
  return result.result;
}

async function deliverApprovals({ fetchFn, crewBaseUrl, token, chatId, deliveredIds }) {
  const store = await readBootstrap(fetchFn, crewBaseUrl);
  const pending = store.pendingApprovals ?? [];
  const bots = store.bots ?? [];
  const outbox = store.outbox ?? [];

  for (const approval of selectNewApprovals(pending, deliveredIds)) {
    const card = buildApprovalCard(
      approval,
      bots.find((bot) => bot.id === approval.botId),
      outbox
    );
    await telegramRequest(fetchFn, token, "sendMessage", {
      chat_id: chatId,
      text: card.text,
      reply_markup: {
        inline_keyboard: [
          card.buttons.map((button) => ({
            text: button.text,
            callback_data: button.callbackData,
          })),
        ],
      },
    });
    deliveredIds.add(approval.id);
  }
}

async function answerCallback(fetchFn, token, callbackQueryId, text, showAlert = false) {
  await telegramRequest(fetchFn, token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

async function processUpdate({ update, fetchFn, crewBaseUrl, token, chatId }) {
  const store = await readBootstrap(fetchFn, crewBaseUrl);
  const pendingIds = new Set((store.pendingApprovals ?? []).map((approval) => approval.id));
  const verdict = evaluateUpdate(update, chatId, pendingIds);

  if (verdict.kind === "ignored") return;
  if (verdict.kind === "unauthorized") {
    console.error("Refused an approval callback from an unauthorized Telegram account.");
    await answerCallback(fetchFn, token, verdict.callbackQueryId, "Not authorized.", true);
    return;
  }
  if (verdict.kind === "already-handled") {
    await answerCallback(fetchFn, token, verdict.callbackQueryId, "Already handled.", true);
    return;
  }

  const response = await fetchFn(`${crewBaseUrl}/api/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalId: verdict.approvalId, decision: verdict.decision }),
  });
  if (!response.ok) throw new Error(`Homestead approval returned status ${response.status}.`);
  await answerCallback(
    fetchFn,
    token,
    verdict.callbackQueryId,
    verdict.decision === "approved" ? "Approved." : "Denied."
  );
}

async function approvalLoop(context) {
  for (;;) {
    try {
      await deliverApprovals(context);
    } catch {
      console.error("Could not poll or deliver Homestead approvals; retrying.");
    }
    await delay(APPROVAL_POLL_MS);
  }
}

async function updateLoop(context) {
  let offset = 0;
  for (;;) {
    try {
      const updates = await telegramRequest(context.fetchFn, context.token, "getUpdates", {
        offset,
        timeout: TELEGRAM_POLL_SECONDS,
        allowed_updates: ["callback_query"],
      });
      for (const update of updates) {
        try {
          await processUpdate({ ...context, update });
        } catch {
          console.error("Could not process a Telegram approval callback.");
        } finally {
          if (typeof update.update_id === "number") offset = Math.max(offset, update.update_id + 1);
        }
      }
    } catch {
      console.error("Could not poll Telegram updates; retrying.");
      await delay(APPROVAL_POLL_MS);
    }
  }
}

export async function main({ env = process.env, fetchFn = fetch, readFile = fs.readFileSync } = {}) {
  const resolved = resolveBridgeConfig(env, readFile);
  if (!resolved.ok) {
    return { exitCode: 1, error: `${resolved.error}\n` };
  }

  const port = env.PORT || 43177;
  const context = {
    fetchFn,
    crewBaseUrl: `http://127.0.0.1:${port}`,
    ...resolved.config,
    deliveredIds: new Set(),
  };
  await Promise.all([approvalLoop(context), updateLoop(context)]);
  return { exitCode: 0, error: "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main();
  if (result.error) process.stderr.write(result.error);
  process.exitCode = result.exitCode;
}
