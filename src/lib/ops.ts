import type { Bot, Conversation, Plugin, Provider, Routine, Settings, Skill } from "@/lib/types";

export type MutateOp =
  | { op: "createBot"; bot: Partial<Bot> }
  | { op: "updateBot"; id: string; patch: Partial<Bot> }
  | { op: "archiveBot"; id: string }
  | { op: "createConversation"; kind: "dm" | "group"; botIds: string[]; title?: string }
  | { op: "updateConversation"; id: string; patch: Partial<Conversation> }
  | { op: "deleteConversation"; id: string }
  | { op: "clearConversation"; id: string }
  | { op: "createSkill"; skill: Partial<Skill> }
  | { op: "updateSkill"; id: string; patch: Partial<Skill> }
  | { op: "deleteSkill"; id: string }
  | { op: "createRoutine"; routine: Partial<Routine> }
  | { op: "updateRoutine"; id: string; patch: Partial<Routine> }
  | { op: "deleteRoutine"; id: string }
  | { op: "updateSettings"; patch: { [K in keyof Settings]?: Settings[K] | null } }
  | { op: "createProvider"; provider: Partial<Provider> }
  | { op: "updateProvider"; id: string; patch: Partial<Provider> }
  | { op: "deleteProvider"; id: string }
  | { op: "createPlugin"; plugin: Partial<Plugin> }
  | { op: "updatePlugin"; id: string; patch: Partial<Plugin> }
  | { op: "deletePlugin"; id: string }
  | { op: "react"; messageId: string; emoji: string }
  | { op: "stop"; conversationId: string }
  | { op: "addAutoReview"; kind: "require-approval" | "always-allow"; pattern: string }
  | { op: "removeAutoReview"; id: string }
  | { op: "createOutboxItem"; name: string; profileUrl: string; text: string; note?: string; lane?: "A" | "B"; kind?: "message" | "invite" }
  | { op: "updateOutboxItem"; id: string; text: string }
  | { op: "approveOutboxItems"; ids: string[] }
  | { op: "rejectOutboxItem"; id: string }
  | { op: "failOutboxItem"; id: string }
  | { op: "confirmOutboxItemSent"; id: string; evidence: string }
  | { op: "revertOutboxItemSent"; id: string; evidence: string }
  | { op: "deleteOutboxItem"; id: string }
  | { op: "markXReplyPosted"; id: string }
  | { op: "dropXReply"; id: string };
