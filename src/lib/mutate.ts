import fs from "node:fs/promises";
import path from "node:path";

import type { Bot, Conversation, Plugin, Provider, Routine, Settings, Skill } from "@/lib/types";
import type { MutateOp } from "@/lib/ops";
import { stopConversation } from "@/lib/agent/run";
import { writeComputerFile } from "@/lib/computer";
import { nid, nowIso, slugify } from "@/lib/ids";
import { DATA_DIR, ensureDir } from "@/lib/paths";
import { nextRun } from "@/lib/routines";
import { updateStore } from "@/lib/store";
import {
  approveOutboxItems,
  confirmOutboxItemSent,
  createOutboxItem,
  deleteOutboxItem,
  failOutboxItem,
  rejectOutboxItem,
  revertOutboxItemSent,
  updateOutboxItem,
} from "@/lib/outbox";
import { onOutboxItemSettled } from "@/lib/outbox-bot";
import { measureOutboxAftermath } from "@/lib/outbox-aftermath";
import { dropXReply, markXReplyPosted } from "@/lib/x-replies";

export type { MutateOp };

export async function mutate(body: MutateOp) {
  if (body.op === "stop") {
    stopConversation(body.conversationId);
    return { ok: true };
  }

  if (body.op === "clearConversation") {
    stopConversation(body.id);
    return updateStore(async (store) => {
      const conversation = store.conversations.find((c) => c.id === body.id);
      if (!conversation) throw new Error("Conversation not found.");

      const messages = store.messages.filter((m) => m.conversationId === body.id);
      const pendingApprovals = store.pendingApprovals.filter((a) => a.conversationId === body.id);
      const clearedAt = nowIso();
      const archiveDir = path.join(DATA_DIR, "archive");
      const archivePath = path.join(
        archiveDir,
        `${conversation.id}-${clearedAt.replace(/:/g, "-")}.json`
      );
      ensureDir(archiveDir);
      await fs.writeFile(
        archivePath,
        JSON.stringify(
          {
            conversationId: conversation.id,
            title: conversation.title,
            clearedAt,
            messages,
            pendingApprovals,
          },
          null,
          2
        ),
        "utf8"
      );

      store.messages = store.messages.filter((m) => m.conversationId !== body.id);
      store.pendingApprovals = store.pendingApprovals.filter((a) => a.conversationId !== body.id);
      conversation.updatedAt = clearedAt;
      return {
        archivePath,
        messages: messages.length,
        approvals: pendingApprovals.length,
      };
    });
  }

  return updateStore((store) => {
    switch (body.op) {
      case "createBot": {
        const bot: Bot = {
          id: nid("bot"),
          name: body.bot.name || "New Bot",
          job: body.bot.job || "Teammate",
          instructions: body.bot.instructions || "",
          memory: "",
          emoji: body.bot.emoji || "✦",
          color: body.bot.color || "#d6a24a",
          providerId: body.bot.providerId || store.providers[0]?.id || "prov_demo",
          model: body.bot.model || store.providers[0]?.defaultModel || "crew-demo",
          createdAt: nowIso(),
        };
        store.bots.push(bot);
        store.conversations.push({
          id: nid("convo"),
          kind: "dm",
          title: bot.name,
          botIds: [bot.id],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        return { bot };
      }
      case "updateBot": {
        const bot = store.bots.find((b) => b.id === body.id);
        if (!bot) throw new Error("Bot not found.");
        Object.assign(bot, body.patch);
        const dm = store.conversations.find((c) => c.kind === "dm" && c.botIds.length === 1 && c.botIds[0] === bot.id);
        if (dm && body.patch.name) dm.title = body.patch.name;
        return { bot };
      }
      case "archiveBot": {
        const bot = store.bots.find((b) => b.id === body.id);
        if (bot) bot.archived = true;
        return { ok: true };
      }
      case "createConversation": {
        const convo: Conversation = {
          id: nid("convo"),
          kind: body.kind,
          title:
            body.title ||
            (body.kind === "group"
              ? store.bots
                  .filter((b) => body.botIds.includes(b.id))
                  .map((b) => b.name)
                  .join(", ")
              : "Chat"),
          botIds: body.botIds,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.conversations.push(convo);
        return { conversation: convo };
      }
      case "updateConversation": {
        const convo = store.conversations.find((c) => c.id === body.id);
        if (!convo) throw new Error("Conversation not found.");
        Object.assign(convo, body.patch);
        return { conversation: convo };
      }
      case "deleteConversation": {
        store.conversations = store.conversations.filter((c) => c.id !== body.id);
        store.messages = store.messages.filter((m) => m.conversationId !== body.id);
        return { ok: true };
      }
      case "createSkill": {
        const name = body.skill.name || "Untitled skill";
        const skill: Skill = {
          id: nid("skill"),
          name,
          slug: slugify(body.skill.slug || name),
          body: body.skill.body || "",
          createdAt: nowIso(),
        };
        store.skills.push(skill);
        return { skill };
      }
      case "updateSkill": {
        const skill = store.skills.find((s) => s.id === body.id);
        if (!skill) throw new Error("Skill not found.");
        Object.assign(skill, body.patch);
        if (body.patch.name && !body.patch.slug) skill.slug = slugify(body.patch.name);
        return { skill };
      }
      case "deleteSkill": {
        store.skills = store.skills.filter((s) => s.id !== body.id);
        return { ok: true };
      }
      case "createRoutine": {
        const cron = body.routine.cron || "0 8 * * 1-5";
        const timezone = body.routine.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const routine: Routine = {
          id: nid("rtn"),
          name: body.routine.name || "Routine",
          botId: body.routine.botId || store.bots[0].id,
          conversationId: body.routine.conversationId || store.conversations[0].id,
          skillId: body.routine.skillId,
          prompt: body.routine.prompt || "",
          cron,
          timezone,
          enabled: body.routine.enabled ?? false,
          createdAt: nowIso(),
        };
        try {
          routine.nextRunAt = nextRun(cron, timezone);
        } catch {
          throw new Error("Invalid cron expression.");
        }
        store.routines.push(routine);
        return { routine };
      }
      case "updateRoutine": {
        const routine = store.routines.find((r) => r.id === body.id);
        if (!routine) throw new Error("Routine not found.");
        Object.assign(routine, body.patch);
        if (body.patch.cron || body.patch.timezone) {
          routine.nextRunAt = nextRun(routine.cron, routine.timezone);
        }
        return { routine };
      }
      case "deleteRoutine": {
        store.routines = store.routines.filter((r) => r.id !== body.id);
        return { ok: true };
      }
      case "updateSettings": {
        const settings: Partial<Settings> = store.settings;
        for (const [key, value] of Object.entries(body.patch)) {
          if (value === null) delete settings[key as keyof Settings];
          else Object.assign(store.settings, { [key]: value });
        }
        return { settings: store.settings };
      }
      case "createProvider": {
        const provider: Provider = {
          id: nid("prov"),
          name: body.provider.name || "Custom provider",
          kind: body.provider.kind || "openai-compatible",
          baseUrl: body.provider.baseUrl || "",
          apiKey: body.provider.apiKey || "",
          defaultModel: body.provider.defaultModel || "",
        };
        store.providers.push(provider);
        return { provider: { ...provider, apiKey: provider.apiKey ? "••••••••" : "" } };
      }
      case "updateProvider": {
        const provider = store.providers.find((p) => p.id === body.id);
        if (!provider) throw new Error("Provider not found.");
        const patch = { ...body.patch };
        if (patch.apiKey === "••••••••") delete patch.apiKey;
        Object.assign(provider, patch);
        return { provider: { ...provider, apiKey: provider.apiKey ? "••••••••" : "" } };
      }
      case "deleteProvider": {
        store.providers = store.providers.filter((p) => p.id !== body.id);
        return { ok: true };
      }
      case "createPlugin": {
        const plugin: Plugin = {
          id: nid("plug"),
          name: body.plugin.name || "Plugin",
          description: body.plugin.description || "",
          baseUrl: body.plugin.baseUrl || "",
          headers: body.plugin.headers || {},
        };
        store.plugins.push(plugin);
        return { plugin };
      }
      case "updatePlugin": {
        const plugin = store.plugins.find((p) => p.id === body.id);
        if (!plugin) throw new Error("Plugin not found.");
        Object.assign(plugin, body.patch);
        return { plugin };
      }
      case "deletePlugin": {
        store.plugins = store.plugins.filter((p) => p.id !== body.id);
        return { ok: true };
      }
      case "react": {
        const message = store.messages.find((m) => m.id === body.messageId);
        if (!message) throw new Error("Message not found.");
        if (message.reactions.includes(body.emoji)) {
          message.reactions = message.reactions.filter((e) => e !== body.emoji);
        } else {
          message.reactions.push(body.emoji);
        }
        return { message };
      }
      case "addAutoReview": {
        const rule = { id: nid("rule"), kind: body.kind, pattern: body.pattern };
        store.settings.autoReview.push(rule);
        return { rule };
      }
      case "removeAutoReview": {
        store.settings.autoReview = store.settings.autoReview.filter((r) => r.id !== body.id);
        return { ok: true };
      }
      case "createOutboxItem":
        return {
          item: createOutboxItem(store, {
            name: body.name,
            profileUrl: body.profileUrl,
            text: body.text,
            note: body.note,
            lane: body.lane,
            kind: body.kind,
            createdBy: "operator",
          }),
        };
      case "updateOutboxItem":
        return { item: updateOutboxItem(store, body) };
      case "approveOutboxItems":
        return { items: approveOutboxItems(store, body) };
      case "rejectOutboxItem":
        return { item: rejectOutboxItem(store, body) };
      case "failOutboxItem": {
        const wasSending = store.outbox?.find((candidate) => candidate.id === body.id)?.status === "sending";
        const item = failOutboxItem(store, body);
        if (wasSending && item.status === "failed") {
          onOutboxItemSettled(store, "failed");
          void measureOutboxAftermath(item.id).catch(() => {});
        }
        return { item };
      }
      case "confirmOutboxItemSent": {
        const wasSending = store.outbox?.find((candidate) => candidate.id === body.id)?.status === "sending";
        const item = confirmOutboxItemSent(store, body);
        if (wasSending) onOutboxItemSettled(store, "sent");
        return { item };
      }
      case "revertOutboxItemSent":
        return { item: revertOutboxItemSent(store, body) };
      case "deleteOutboxItem":
        return deleteOutboxItem(store, body);
      case "markXReplyPosted":
        return { item: markXReplyPosted(store, body) };
      case "dropXReply":
        return { item: dropXReply(store, body) };
      default:
        throw new Error("Unknown operation.");
    }
  });
}

export async function saveUpload(filename: string, content: Buffer | string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const rel = `inbox/${Date.now()}-${safe}`;
  const text = typeof content === "string" ? content : content.toString("utf8");
  await writeComputerFile(rel, text);
  return { path: rel, name: safe };
}
