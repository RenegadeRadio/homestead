import type { Bot, Plugin } from "@/lib/types";

export const TOOL_DEFINITIONS = [
  {
    name: "list_files",
    description: "List files and folders on the shared computer.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path. Default is the computer root." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the shared computer.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Search text in files on the shared computer. Read-only, needs no approval. Use it instead of run_command grep.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string", description: "Relative path. Default is the computer root." },
        regex: { type: "boolean" },
        ignoreCase: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file on the shared computer. Use this to leave real deliverables, not chat drafts.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command in the shared computer directory. Destructive or outbound commands may require user approval.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    name: "web_search",
    description: "Search the public web. Use before making claims about current events.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_url",
    description: "Fetch a public URL as text. For logged-in sites (LinkedIn, Gmail, dashboards), use the shared browser instead.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_navigate",
    description: "Open a URL in the shared computer browser. Cookies and logins persist. Use this for LinkedIn and any site that needs a session. X has a daily page-load budget; search X by navigating to a search URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_snapshot",
    description: "Read the current browser page as a list of numbered interactive elements. Call this before clicking.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "browser_screenshot",
    description: "Look at the page as the operator sees it, with every numbered element's position in the same pixels as the image. Before clicking anything that acts on a person (Message, Connect, Send), look first and click the ref whose position sits under that person's name. After opening a message box, look again and confirm the box's header names the intended person before typing.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "browser_click",
    description: "Click an element from the latest snapshot by ref, or by x,y. Clicks that send, post, publish, or invite require user approval.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "number", description: "Number from browser_snapshot, e.g. 12" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "browser_type",
    description: "Type into the focused field, or click a ref first then type. Never type passwords. Ask the user to take over.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        ref: { type: "number" },
      },
      required: ["text"],
    },
  },
  {
    name: "browser_press",
    description: "Press a key in the browser (Enter, Tab, Escape, Meta+A, Backspace).",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the shared browser. Pass ref to scroll the element under it instead of the page; use this for lists that scroll inside their own panel, like Sales Navigator's results list.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["down", "up"] },
        ref: {
          type: "number",
          description: "Number from browser_snapshot, e.g. 12. Scrolls the element under that ref (its inner scroll container) instead of the whole page.",
        },
      },
    },
  },
  {
    name: "request_takeover",
    description: "Pause and ask the user to take over the computer for password, 2FA, CAPTCHA, or a payment. Do not ask them to paste secrets into chat.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "remember",
    description: "Persist a stable preference or working note on this Bot. Do not store secrets.",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string" },
      },
      required: ["note"],
    },
  },
  {
    name: "save_skill",
    description: "Save a reusable workflow the team can invoke with /slug.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        body: { type: "string", description: "Steps, decision rules, expected output, and approval boundaries." },
      },
      required: ["name", "body"],
    },
  },
  {
    name: "message_bot",
    description: "Hand work to another Bot on this computer. They wake, do their part, and can reply in this conversation.",
    parameters: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Name or id of the teammate." },
        note: { type: "string", description: "A brief they can act on without you in the middle." },
      },
      required: ["bot", "note"],
    },
  },
  {
    name: "call_plugin",
    description: "Call a connected HTTP plugin/connector.",
    parameters: {
      type: "object",
      properties: {
        plugin: { type: "string", description: "Plugin name or id." },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", description: "Path appended to the plugin base URL." },
        body: { type: "string", description: "JSON body for methods that accept one." },
      },
      required: ["plugin", "method", "path"],
    },
  },
  {
    name: "queue_linkedin_message",
    description: "Queue a LinkedIn message for the operator to approve in the Outbox. It is never sent by this tool.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        profileUrl: { type: "string" },
        text: { type: "string" },
        lane: {
          type: "string",
          enum: ["A", "B"],
          description: "Optional campaign label, A or B, to keep two outreach campaigns apart; leave it out for anything that is not outreach.",
        },
        kind: {
          type: "string",
          enum: ["message", "invite"],
          description: "invite when the person is not yet a connection; the text is then the invite note, 200 characters at most.",
        },
        note: {
          type: "string",
          description: "The research this draft rests on: the facts it uses, each with its quote and URL.",
        },
      },
      required: ["name", "profileUrl", "text"],
    },
  },
  {
    name: "record_linkedin_prospect",
    description: "Records a person who has not been contacted in the CRM and never sends anything.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        profileUrl: { type: "string" },
        lane: { type: "string", enum: ["A", "B"] },
        source: {
          type: "string",
          enum: ["linkedin", "inbound"],
          description: "linkedin for a profile found in search; inbound for someone who connected or reached out without a send.",
        },
        status: { type: "string", enum: ["queued", "connected"] },
        note: { type: "string" },
        country: {
          type: "string",
          description:
            "The country the person is in, written as a full name in English, for example South Africa or United Kingdom.",
        },
        company: { type: "string" },
        role: { type: "string" },
        headcount: {
          type: "string",
          enum: ["1-10", "11-50", "51-200", "201-500", "500+", "unknown"],
          description:
            "the staff-count band read from the company's own website or another public source; unknown if not found; never guessed",
        },
        headcountSource: {
          type: "string",
          description: "the URL the band came from; required when headcount is a band",
        },
        industry: { type: "string" },
      },
      required: ["name", "profileUrl", "lane", "source", "status", "note"],
    },
  },
  {
    name: "record_linkedin_prospects",
    description: "Records a batch of people who have not been contacted in the CRM and never sends anything.",
    parameters: {
      type: "object",
      properties: {
        prospects: {
          type: "array",
          description: "Up to 50 people to record.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              profileUrl: { type: "string" },
              lane: { type: "string", enum: ["A", "B"] },
              source: {
                type: "string",
                enum: ["linkedin", "inbound"],
                description: "linkedin for a profile found in search; inbound for someone who connected or reached out without a send.",
              },
              status: { type: "string", enum: ["queued", "connected"] },
              note: { type: "string" },
              country: {
                type: "string",
                description:
                  "The country the person is in, written as a full name in English, for example South Africa or United Kingdom.",
              },
              company: { type: "string" },
              role: { type: "string" },
              headcount: {
                type: "string",
                enum: ["1-10", "11-50", "51-200", "201-500", "500+", "unknown"],
                description:
                  "the staff-count band read from the company's own website or another public source; unknown if not found; never guessed",
              },
              headcountSource: {
                type: "string",
                description: "the URL the band came from; required when headcount is a band",
              },
              industry: { type: "string" },
              salesNavUrl: {
                type: "string",
                description: "The Sales Navigator lead URL where the person was found.",
              },
            },
            required: ["name", "profileUrl", "lane", "source", "status", "note"],
          },
        },
      },
      required: ["prospects"],
    },
  },
  {
    name: "record_linkedin_thread",
    description:
      "Records what a LinkedIn conversation already contains after it has been read, and never sends anything.",
    parameters: {
      type: "object",
      properties: {
        profileUrl: { type: "string" },
        lastFromOperatorAt: {
          type: "string",
          description: "ISO date of the operator's most recent message to this person.",
        },
        lastFromOperatorLine: {
          type: "string",
          description: "The first line of the operator's most recent message to this person.",
        },
      },
      required: ["profileUrl"],
    },
  },
  {
    name: "record_invite_already_sent",
    description:
      "Records that LinkedIn already shows the invitation to this profile as Pending. Sends nothing and loads no page.",
    parameters: {
      type: "object",
      properties: {
        profileUrl: { type: "string" },
        evidence: {
          type: "string",
          description: "What was seen, for example the Pending button in the More menu.",
        },
      },
      required: ["profileUrl", "evidence"],
    },
  },
  {
    name: "list_linkedin_prospects",
    description: "Lists recorded LinkedIn prospects without changing them or loading a page. All supplied filters apply together. Each prospect shows its latest Outbox follow-up and that item's status; only draft and approved items are waiting for the operator.",
    parameters: {
      type: "object",
      properties: {
        lane: { type: "string", enum: ["A", "B"] },
        status: {
          type: "string",
          enum: ["queued", "connected", "pending", "messaged", "accepted"],
        },
        headcount: {
          type: "array",
          items: { type: "string", enum: ["1-10", "11-50", "51-200", "201-500", "500+", "unknown"] },
        },
        industry: { type: "string" },
        country: { type: "string" },
        outOfTarget: { type: "boolean" },
        slugs: {
          type: "array",
          items: { type: "string" },
          description:
            "Up to 50 LinkedIn profile slugs. When given, returns exactly the prospects with these slugs (case-insensitive), ignores limit, still applies lane and status, and names any slug that was not found.",
        },
        limit: { type: "number", description: "Defaults to 50; capped at 200." },
      },
    },
  },
  {
    name: "record_linkedin_acceptances",
    description:
      "Records CRM acceptance status only and never sends anything on LinkedIn or loads a page.",
    parameters: {
      type: "object",
      properties: {
        slugs: {
          type: "array",
          description: "Up to 50 LinkedIn profile slugs of people who accepted an invite.",
          items: { type: "string" },
        },
      },
      required: ["slugs"],
    },
  },
  {
    name: "invite_note_report",
    description:
      "Reports invite note acceptance results from Homestead's own records only and never loads a page.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "record_x_reply",
    description: "Save a draft reply to an X post for the operator, who posts replies by hand. Nothing the Bot does will post, reply, like, repost, or follow on X. Replies are limited to 280 characters and postUrl must look like https://x.com/<handle>/status/<digits>.",
    parameters: {
      type: "object",
      properties: {
        postUrl: { type: "string" },
        author: { type: "string", description: "The post author's handle." },
        postExcerpt: { type: "string" },
        text: { type: "string" },
        note: { type: "string", description: "The facts the reply rests on." },
        postAt: { type: "string", description: "when the post was published, ISO 8601, read from the post's timestamp" },
      },
      required: ["postUrl", "author", "postExcerpt", "text"],
    },
  },
  {
    name: "record_company_candidate",
    description:
      "Records whether a company qualifies for a lane, judged from its own site or GitHub, before any LinkedIn page is loaded. It never loads a page. A company already settled as yes or no for that lane is refused.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string" },
        name: { type: "string" },
        lane: { type: "string", enum: ["A", "B"] },
        verdict: { type: "string", enum: ["yes", "no", "unsure"] },
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              criterion: {
                type: "string",
                description: "The criterion as the lane's strategy words it.",
              },
              answer: { type: "string", enum: ["yes", "no", "unknown"] },
              url: { type: "string", description: "Required unless unknown." },
              quote: { type: "string", description: "Required unless unknown." },
            },
            required: ["criterion", "answer"],
          },
        },
      },
      required: ["domain", "lane", "verdict", "criteria"],
    },
  },
  {
    name: "list_company_candidates",
    description:
      "Lists recorded company candidates with their criteria and evidence without loading a page. Optional filters are applied together.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string" },
        lane: { type: "string", enum: ["A", "B"] },
        verdict: { type: "string", enum: ["yes", "no", "unsure"] },
      },
    },
  },
] as const;

export function openaiTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function anthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function toolPromptAppendix(bots: Bot[], plugins: Plugin[]) {
  const teammates = bots
    .filter((b) => !b.archived)
    .map((b) => `- ${b.name} (${b.job}): ${b.id}`)
    .join("\n");
  const pluginLines =
    plugins.length === 0
      ? "None connected. Do not invent plugins."
      : plugins.map((p) => `- ${p.name}: ${p.description} (${p.id})`).join("\n");
  return `\n\nTeammates you can message_bot:\n${teammates}\n\nPlugins:\n${pluginLines}`;
}
