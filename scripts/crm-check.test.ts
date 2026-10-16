import { describe, expect, it, vi } from "vitest";

import {
  computeResults,
  fetchAllNotionRows,
  linkedinSlug,
  main,
  parseCsv,
  parseSentPage,
} from "./crm-check.mjs";

const notionPage = (id: string, name: string) => ({
  id,
  properties: {
    Name: { title: [{ plain_text: name }] },
    Status: { select: { name: "queued" } },
    LinkedIn: { url: `https://linkedin.com/in/${name.toLowerCase()}` },
    "CRM ID": { number: Number(id) },
  },
});

describe("CRM check parsers", () => {
  it("parses quoted CSV commas, doubled quotes, and newlines", () => {
    const rows = parseCsv(
      'From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl\r\nMe,Ada,Today,"Hello, ""Ada""\nHow are you?",OUTGOING,https://linkedin.com/in/me,https://linkedin.com/in/ada\r\n'
    );
    expect(rows[1]).toEqual([
      "Me",
      "Ada",
      "Today",
      'Hello, "Ada"\nHow are you?',
      "OUTGOING",
      "https://linkedin.com/in/me",
      "https://linkedin.com/in/ada",
    ]);
  });

  it("extracts three names from CRLF Sent-page text with blank lines", () => {
    const fixture =
      "Ada Lovelace\r\nEngineer\r\nSent 2 weeks ago\r\nWithdraw\r\n\r\nGrace Hopper\r\nAdmiral\r\nSent 1 month ago\r\nWithdraw\r\n\r\nLinus Torvalds\r\nDeveloper\r\nSent yesterday\r\nWithdraw\r\n";
    expect(parseSentPage(fixture)).toEqual(["Ada Lovelace", "Grace Hopper", "Linus Torvalds"]);
  });

  it("ignores 'Sent ' lines that are not invitation entries", () => {
    const fixture = [
      "Ada Lovelace",
      "Engineer",
      "Sent 2 days ago",
      "Withdraw",
      "Sent (49)",
      "Grace Hopper",
      "Admiral",
      "Sent 1 month ago",
      "Withdraw",
      "Sent you a note last week",
      "Show more results",
    ].join("\n");

    expect(parseSentPage(fixture)).toEqual(["Ada Lovelace", "Grace Hopper"]);
  });

  it("extracts decoded, lowercase LinkedIn slugs", () => {
    expect(linkedinSlug("https://za.linkedin.com/in/Alan-Turing-59a2ba65/")).toBe(
      "alan-turing-59a2ba65"
    );
    expect(linkedinSlug("https://www.linkedin.com/in/ren%C3%A9-descartes-a4193b15")).toBe(
      "rené-descartes-a4193b15"
    );
    expect(linkedinSlug("https://www.linkedin.com/in/x?trk=y")).toBe("x");
  });
});

describe("CRM verdicts", () => {
  const invitation = (To: string, slug: string) => ({
    To,
    Direction: "OUTGOING",
    inviteeProfileUrl: `https://linkedin.com/in/${slug}`,
  });
  const row = (crmId: number, name: string, status: string, slug: string) => ({
    crmId,
    name,
    status,
    linkedin: `https://linkedin.com/in/${slug}`,
  });

  it("reports pending and unsent status contradictions", () => {
    const results = computeResults(
      [row(1, "Ada", "connected", "ada"), row(2, "Nobody", "pending", "nobody")],
      [invitation("Ada Lovelace", "ada")],
      ["Ada Lovelace"]
    );
    expect(results.mismatches.map(({ expected }) => expected)).toEqual([
      ["pending"],
      ["queued", "held", "blocked"],
    ]);
  });

  it("accepts a post-invitation status and reports an export row missing from Notion", () => {
    const results = computeResults(
      [row(1, "Ada", "messaged", "ada")],
      [invitation("Ada", "ada"), invitation("Grace", "grace")],
      []
    );
    expect(results.mismatches).toEqual([]);
    expect(results.missingRows).toEqual([
      { invitation: invitation("Grace", "grace"), slug: "grace" },
    ]);
  });
});

describe("Notion access and command", () => {
  it("follows pagination and puts the token only in the Authorization header", async () => {
    const token = "secret-token";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [notionPage("1", "Ada")], has_more: true, next_cursor: "next" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [notionPage("2", "Grace")], has_more: false, next_cursor: null }),
      });
    const rows = await fetchAllNotionRows({ token, databaseId: "database", fetchFn });

    expect(rows.map(({ name }) => name)).toEqual(["Ada", "Grace"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchFn.mock.calls) {
      expect(url).not.toContain(token);
      expect(options.body).not.toContain(token);
      expect(options.headers.Authorization).toBe(`Bearer ${token}`);
      const otherHeaders = Object.entries(options.headers).filter(
        ([name]) => name !== "Authorization"
      );
      expect(JSON.stringify(otherHeaders)).not.toContain(token);
    }
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ start_cursor: "next" });
  });

  it("requires token configuration and never includes a configured token in output", async () => {
    const missing = await main({ argv: [], env: {}, fetchFn: vi.fn(), readFile: vi.fn() });
    expect(missing.exitCode).toBe(2);
    expect(missing.output).toContain("CREW_NOTION_TOKEN");
    expect(missing.output).toContain("CREW_NOTION_TOKEN_FILE");

    const token = "never-print-this";
    const failed = await main({
      argv: ["--invitations", "invitations.csv", "--sent", "sent.txt"],
      env: { CREW_NOTION_TOKEN: token },
      fetchFn: vi.fn().mockRejectedValue(new Error(`failure ${token}`)),
      readFile: vi.fn().mockReturnValue(""),
    });
    expect(failed.exitCode).toBe(2);
    expect(failed.output).not.toContain(token);
  });
});
