export type Id = string;

export type ProviderKind = "openai-compatible" | "anthropic" | "claude-code" | "demo";

export type ShellPolicy = "ask" | "allow" | "never";

export type ConversationKind = "dm" | "group";

export type MessageRole = "user" | "assistant" | "system";

export interface Provider {
  id: Id;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface Bot {
  id: Id;
  name: string;
  job: string;
  instructions: string;
  memory: string;
  emoji: string;
  color: string;
  providerId: Id;
  model: string;
  createdAt: string;
  archived?: boolean;
}

export interface Conversation {
  id: Id;
  kind: ConversationKind;
  title: string;
  botIds: Id[];
  createdAt: string;
  updatedAt: string;
}

export type ToolStatus = "running" | "done" | "error" | "awaiting_approval";

export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      args: unknown;
      result?: string;
      status: ToolStatus;
    }
  | {
      type: "approval";
      id: string;
      title: string;
      detail: string;
      command?: string;
      kind?: "shell" | "send" | "takeover";
      status: "pending" | "approved" | "denied";
    }
  | {
      type: "handoff";
      fromBotId: Id;
      toBotId: Id;
      note: string;
    }
  | { type: "file"; path: string; action: "created" | "updated" | "read" }
  | { type: "attachment"; name: string; path: string };

export interface Message {
  id: Id;
  conversationId: Id;
  role: MessageRole;
  botId?: Id;
  parts: MessagePart[];
  createdAt: string;
  reactions: string[];
}

export interface Skill {
  id: Id;
  name: string;
  slug: string;
  body: string;
  createdAt: string;
}

export interface Routine {
  id: Id;
  name: string;
  botId: Id;
  conversationId: Id;
  skillId?: Id;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface Plugin {
  id: Id;
  name: string;
  description: string;
  baseUrl: string;
  headers: Record<string, string>;
}

export interface AutoReviewRule {
  id: Id;
  kind: "require-approval" | "always-allow";
  pattern: string;
}

export interface InviteNoteVariant {
  id: string;
  lane: "A" | "B";
  phrase: string;
}

export interface Settings {
  shellPolicy: ShellPolicy;
  autoReview: AutoReviewRule[];
  computerRoot: string;
  linkedinGapSeconds?: number;
  linkedinGapMaxSeconds?: number;
  linkedinActionGapMinSeconds?: number;
  linkedinActionGapMaxSeconds?: number;
  linkedinNextActionAt?: string;
  linkedinSendWindowStart?: string;
  linkedinSendWindowEnd?: string;
  linkedinSendWeekdaysOnly?: boolean;
  linkedinDailyInviteCap?: number;
  prospectHeadcountTargets?: { A?: string[]; B?: string[] };
  linkedinWeeklyInviteCap?: number;
  linkedinInvitesPausedUntil?: string;
  linkedinInvitePauseReason?: string;
  linkedinDailyPageLoads?: number;
  linkedinPageLoads?: string[];
  xDailyPageLoads?: number;
  xPageLoads?: string[];
  xHold?: string;
  xNextActionAt?: string;
  xActionGapMinSeconds?: number;
  xActionGapMaxSeconds?: number;
  xReplyExpiryHours?: number;
  linkedinHold?: string;
  outboxStallMinutes?: number;
  outboxRecentMessageDays?: number;
  outboxSendWithoutFinalApproval?: boolean;
  outboxDirectInvites?: boolean;
  outboxRunActive?: boolean;
  toolBudgetPerTurn?: number;
  linkedinLastActionAt?: string;
  linkedinSendGapSeconds?: number;
  draftBannedPhrases?: string[];
  inviteNoteVariants?: InviteNoteVariant[];
  standingRules?: string;
}

export interface ComputerLog {
  id: Id;
  at: string;
  botId: Id;
  kind: "command" | "file" | "browse" | "plugin" | "search" | "browser";
  summary: string;
  detail?: string;
  url?: string;
}

export interface BrowseSnapshot {
  id: Id;
  at: string;
  botId: Id;
  url: string;
  title: string;
  excerpt: string;
}

export interface PendingApproval {
  id: Id;
  conversationId: Id;
  messageId: Id;
  botId: Id;
  toolName: string;
  args: Record<string, unknown>;
  createdAt: string;
  checkpoint: LlmMessage[];
  kind?: "shell" | "send" | "takeover";
  title?: string;
  resumeSessionId?: string;
}

export type LinkedInSendAction = "click" | "press" | "type";

export type LinkedInSendKind = "invite" | "message" | "unknown";

export type CrmSyncState =
  | "not-configured"
  | "skipped"
  | "no-row"
  | "ambiguous"
  | "synced"
  | "failed";

export interface CrmSyncResult {
  state: CrmSyncState;
  detail: string;
}

export interface LinkedInSendEntry {
  id: Id;
  at: string;
  botId: Id;
  conversationId: Id;
  messageId: Id;
  url: string;
  slug: string | null;
  action: LinkedInSendAction;
  label: string | null;
  key: string | null;
  text: string | null;
  kind: LinkedInSendKind;
  outboxItemId?: string;
  voidedAt?: string;
  voidReason?: string;
  stalled?: boolean;
  lane?: "A" | "B";
  crmSync?: CrmSyncResult & { at: string };
}

export type CrmProspectSource = "linkedin" | "inbound";

export type CrmProspectStatus = "queued" | "connected" | "pending" | "messaged" | "accepted";

export type HeadcountBand = "1-10" | "11-50" | "51-200" | "201-500" | "500+" | "unknown";

export interface CrmProspectEntry {
  id: Id;
  at: string;
  botId: Id;
  name: string;
  profileUrl: string;
  slug: string | null;
  lane: "A" | "B";
  source: CrmProspectSource;
  status: CrmProspectStatus;
  note: string;
  country?: string;
  company?: string;
  role?: string;
  headcount?: HeadcountBand;
  headcountSource?: string;
  industry?: string;
  outOfTarget?: string;
  salesNavUrl?: string;
  syncedAt?: string;
  acceptedSync?: CrmSyncResult & { at: string };
  acceptedAt?: string;
  acceptedAtSource?: "first-seen";
}

export type OutboxStatus = "draft" | "approved" | "sending" | "sent" | "failed" | "rejected";

export interface OutboxItem {
  id: Id;
  name: string;
  profileUrl: string;
  text: string;
  status: OutboxStatus;
  kind?: "message" | "invite";
  lane?: "A" | "B";
  noteVariant?: string;
  note?: string;
  approvedTextHash?: string;
  sendingAt?: string;
  sentAt?: string;
  operatorConfirmation?: { at: string; evidence: string };
  operatorCorrection?: { at: string; evidence: string };
  error?: string;
  aftermath?: {
    at: string;
    composeOpen: boolean;
    draftLeft: boolean;
  };
  threadRead?: {
    at: string;
    lastFromOperatorAt?: string;
    lastFromOperatorLine?: string;
  };
  createdAt: string;
  createdBy: Id | "operator";
}

export interface XReply {
  id: Id;
  postUrl: string;
  author: string;
  postExcerpt: string;
  text: string;
  note?: string;
  postAt?: string;
  status: "draft" | "posted" | "dropped";
  createdAt: string;
  createdBy: Id | "operator";
  postedAt?: string;
}

export interface CompanyCriterionAnswer {
  criterion: string;
  answer: "yes" | "no" | "unknown";
  url?: string;
  quote?: string;
}

export interface CompanyCandidate {
  id: Id;
  at: string;
  updatedAt?: string;
  botId: Id;
  domain: string;
  name?: string;
  lane: "A" | "B";
  verdict: "yes" | "no" | "unsure";
  criteria: CompanyCriterionAnswer[];
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Store {
  providers: Provider[];
  bots: Bot[];
  conversations: Conversation[];
  messages: Message[];
  skills: Skill[];
  routines: Routine[];
  plugins: Plugin[];
  settings: Settings;
  computerLogs: ComputerLog[];
  browseSnapshots: BrowseSnapshot[];
  pendingApprovals: PendingApproval[];
  terminalSessions: TerminalLine[];
  linkedinSendLog?: LinkedInSendEntry[];
  crmProspects?: CrmProspectEntry[];
  outbox?: OutboxItem[];
  xReplies?: XReply[];
  companyCandidates?: CompanyCandidate[];
}

export interface TerminalLine {
  id: Id;
  at: string;
  botId: Id;
  command: string;
  output: string;
  exitCode: number | null;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

export type CrewEvent =
  | { type: "bot_start"; botId: Id; messageId: Id }
  | { type: "text_delta"; botId: Id; messageId: Id; text: string }
  | {
      type: "tool_start";
      botId: Id;
      messageId: Id;
      toolId: string;
      name: string;
      args: unknown;
    }
  | {
      type: "tool_end";
      botId: Id;
      messageId: Id;
      toolId: string;
      result: string;
      status: ToolStatus;
    }
  | {
      type: "approval";
      botId: Id;
      messageId: Id;
      approval: Extract<MessagePart, { type: "approval" }>;
    }
  | {
      type: "handoff";
      botId: Id;
      messageId: Id;
      fromBotId: Id;
      toBotId: Id;
      note: string;
    }
  | {
      type: "file";
      botId: Id;
      messageId: Id;
      path: string;
      action: "created" | "updated" | "read";
    }
  | { type: "paused"; reason: "approval" | "takeover"; approvalId: Id }
  | { type: "error"; message: string }
  | { type: "done" };
