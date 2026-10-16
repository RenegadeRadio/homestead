import { describe, expect, it } from "vitest";

import { TOOL_DEFINITIONS } from "@/lib/agent/tools";

describe("LinkedIn message tool definition", () => {
  it("exposes draft metadata only on queue_linkedin_message", () => {
    const queueLinkedInMessage = TOOL_DEFINITIONS.find(
      (tool) => tool.name === "queue_linkedin_message"
    );
    const browserType = TOOL_DEFINITIONS.find((tool) => tool.name === "browser_type");

    expect(queueLinkedInMessage?.parameters.properties).toHaveProperty("kind", {
      type: "string",
      enum: ["message", "invite"],
      description: "invite when the person is not yet a connection; the text is then the invite note, 200 characters at most.",
    });
    expect(queueLinkedInMessage?.parameters.properties).toHaveProperty("note", {
      type: "string",
      description: "The research this draft rests on: the facts it uses, each with its quote and URL.",
    });
    expect(browserType?.parameters.properties).not.toHaveProperty("kind");
    expect(browserType?.parameters.properties).not.toHaveProperty("note");
  });
});
