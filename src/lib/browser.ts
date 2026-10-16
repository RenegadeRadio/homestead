import fs from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import { BROWSER_PROFILE, ensureDir } from "@/lib/paths";

export const VIEWPORT = { width: 1280, height: 800 };
export const CAPTCHA_FRAME_SELECTOR =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="challenges.cloudflare.com"]';
export const GATE_TEXT_LIMIT = 1500;

function clearChromeLocks() {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.unlinkSync(path.join(BROWSER_PROFILE, name));
    } catch {
      // already gone
    }
  }
}

export interface SnapshotEl {
  ref: number;
  tag: string;
  role: string;
  text: string;
  href?: string;
  x: number;
  y: number;
}

export interface BrowserStatus {
  running: boolean;
  mode: "bot" | "human";
  url: string;
  title: string;
  takeoverReason: string;
  width: number;
  height: number;
}

type Session = {
  context: BrowserContext;
  page: Page;
  mode: "bot" | "human";
  takeoverReason: string;
  lastSnapshot: SnapshotEl[];
  lastShot: Buffer | null;
};

declare global {
  var __crewBrowser: Session | undefined;
  var __crewBrowserLock: Promise<unknown> | undefined;
}

export function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__crewBrowserLock || Promise.resolve();
  const run = prev.then(fn, fn);
  globalThis.__crewBrowserLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const lock = withBrowserLock;

export async function ensureBrowser() {
  if (globalThis.__crewBrowser?.page && !globalThis.__crewBrowser.page.isClosed()) {
    return globalThis.__crewBrowser;
  }
  ensureDir(BROWSER_PROFILE);
  const launchOpts = {
    headless: true,
    viewport: VIEWPORT,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(BROWSER_PROFILE, {
      channel: "chrome",
      ...launchOpts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already in use|SingletonLock|ProcessSingleton/i.test(msg)) {
      clearChromeLocks();
    }
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE, {
        channel: "chrome",
        ...launchOpts,
      });
    } catch {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE, launchOpts);
    }
  }
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize(VIEWPORT);
  const session: Session = {
    context,
    page,
    mode: "bot",
    takeoverReason: "",
    lastSnapshot: [],
    lastShot: null,
  };
  globalThis.__crewBrowser = session;
  return session;
}

export async function browserStatus(): Promise<BrowserStatus> {
  const session = globalThis.__crewBrowser;
  if (!session || session.page.isClosed()) {
    return {
      running: false,
      mode: "bot",
      url: "",
      title: "",
      takeoverReason: "",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
    };
  }
  return {
    running: true,
    mode: session.mode,
    url: session.page.url(),
    title: await session.page.title().catch(() => ""),
    takeoverReason: session.takeoverReason,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
  };
}

export async function screenshot(): Promise<Buffer> {
  const session = await ensureBrowser();
  const shot = await session.page.screenshot({ type: "jpeg", quality: 55 });
  session.lastShot = shot;
  return shot;
}

export async function snapshotPage(
  page: Page,
  options?: { hideValues?: boolean }
): Promise<SnapshotEl[]> {
  return page.evaluate((opts) => {
    function shadowRoots(root: ParentNode): ShadowRoot[] {
      const found: ShadowRoot[] = [];
      for (const element of root.querySelectorAll("*")) {
        const shadowRoot = element.shadowRoot;
        if (shadowRoot) {
          found.push(shadowRoot);
          found.push(...shadowRoots(shadowRoot));
        }
      }
      return found;
    }

    const hideValues = !!opts?.hideValues;
    const sensitivePattern =
      /\bpin\b|otp|passcode|password|secret|(verification|security|one[\s_-]?time|sms|auth|2fa)[\s_-]*code/i;
    const selector =
      'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="tab"], [contenteditable="true"]';
    const nodes = [
      ...shadowRoots(document).flatMap((root) => [...root.querySelectorAll(selector)]),
      ...document.querySelectorAll(selector),
    ] as HTMLElement[];
    const out: {
      ref: number;
      tag: string;
      role: string;
      text: string;
      href?: string;
      x: number;
      y: number;
    }[] = [];
    let ref = 1;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const isInput = el.tagName.toLowerCase() === "input";
      const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
      const name = el.getAttribute("name") || "";
      const id = el.getAttribute("id") || "";
      const ariaLabel = el.getAttribute("aria-label") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const inputMode = (el.getAttribute("inputmode") || "").toLowerCase();
      const maxLength = parseInt(el.getAttribute("maxlength") || "", 10);
      const textSensitive = [name, id, ariaLabel, placeholder].some((value) =>
        sensitivePattern.test(value)
      );
      const numericShort = inputMode === "numeric" && maxLength >= 1 && maxLength <= 8;
      const sensitive =
        isInput &&
        ((el as HTMLInputElement).type === "password" ||
          ["current-password", "new-password", "one-time-code"].some((token) =>
            autocomplete.includes(token)
          ) ||
          textSensitive ||
          numericShort);
      const text = (sensitive
        ? ariaLabel || placeholder || "(password field)"
        : hideValues
          ? ariaLabel || placeholder || (isInput ? "(input)" : "") || el.innerText || ""
          : ariaLabel ||
            placeholder ||
            (el as HTMLInputElement).value ||
            el.innerText ||
            "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
      let href: string | undefined;
      if (el.tagName.toLowerCase() === "a") {
        const rawHref = (el as HTMLAnchorElement).href;
        if (rawHref) {
          try {
            const parsed = new URL(rawHref);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              href = parsed.origin + parsed.pathname;
            }
          } catch {
            // Ignore destinations that cannot be parsed as URLs.
          }
        }
      }
      out.push({
        ref: ref++,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        text,
        ...(href ? { href } : {}),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      });
      if (out.length >= 70) break;
    }
    return out;
  }, options);
}

export function formatSnapshot(url: string, title: string, els: SnapshotEl[]) {
  let pageOrigin = "";
  try {
    pageOrigin = new URL(url).origin;
  } catch {
    // Leave the origin blank when the page URL cannot be parsed.
  }
  const lines = els.map((el) => {
    const base = `[${el.ref}] ${el.tag}${el.text ? ` “${el.text}”` : ""}`;
    if (!el.href) return base;
    try {
      const parsed = new URL(el.href);
      const destination =
        parsed.origin === pageOrigin ? parsed.pathname : parsed.origin + parsed.pathname;
      return `${base} ${destination}`;
    } catch {
      return `${base} ${el.href}`;
    }
  });
  return `URL: ${url}\nTitle: ${title}\nInteractive elements:\n${lines.join("\n") || "(none visible)"}`;
}

export function formatLook(els: SnapshotEl[]): string {
  const lines = els.map(
    (el) => `[${el.ref}] ${el.tag}${el.text ? ` “${el.text}”` : ""} at (${el.x},${el.y})`
  );
  return lines.join("\n") || "(none visible)";
}

export async function looksLikeHumanGate(page: Page) {
  type GateResult = { needed: boolean; reason: string; signal?: string; detail?: string };
  type FrameCheck = {
    host: string;
    width: number;
    height: number;
    intersectsViewport: boolean;
    visibility: string;
    display: string;
    opacity: string;
  };
  const detected = (reason: string, signal: string, detail?: string): GateResult => ({
    needed: true,
    reason,
    signal,
    detail,
  });

  const url = page.url();
  const title = await page.title().catch(() => "");
  const password = await page.locator('input[type="password"]').count();
  const captchaFrames: FrameCheck[] = await page
    .locator(CAPTCHA_FRAME_SELECTOR)
    .evaluateAll((frames) =>
      frames.map((element) => {
        const frame = element as HTMLIFrameElement;
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        let host = "";
        try {
          host = new URL(frame.src, location.href).host;
        } catch {
          // Leave the host blank when the frame URL cannot be parsed.
        }
        return {
          host,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          intersectsViewport:
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight,
          visibility: style.visibility,
          display: style.display,
          opacity: style.opacity,
        };
      })
    );
  const body = await page.locator("body").innerText().catch(() => "");
  const shortPage = body.trim().length < GATE_TEXT_LIMIT;
  const loginUrl = /\/login|\/checkpoint|\/uas\/authenticate|signin|sign-in|\/auth\b/i.test(url);
  const loginTitle = /\blog[\s-]?in\b|\bsign[\s-]?in\b|\bsign[\s-]?up\b/i.test(title);
  const captchaReason = "This page is asking for a CAPTCHA or human check.";
  const loginReason = "This page needs a sign-in, password, or 2FA step.";

  const captchaFrame = captchaFrames.find(
    (frame) =>
      frame.width >= 100 &&
      frame.height >= 60 &&
      frame.intersectsViewport &&
      frame.visibility !== "hidden" &&
      frame.display !== "none" &&
      frame.opacity !== "0"
  );
  if (captchaFrame) {
    return detected(
      captchaReason,
      "captcha frame",
      captchaFrame.host
        ? `${captchaFrame.host} ${captchaFrame.width}x${captchaFrame.height}`
        : undefined
    );
  }
  if (/captcha|verify you are human|security check|just a moment/i.test(title)) {
    return detected(captchaReason, "captcha title");
  }
  const captchaCopy = shortPage
    ? body.match(/captcha|verify you are human|unusual activity|challenge/i)
    : null;
  if (captchaCopy) {
    return detected(captchaReason, `captcha text: ${captchaCopy[0]}`);
  }
  if (password > 0) {
    return detected(loginReason, "password input");
  }
  if (loginUrl) {
    return detected(loginReason, "login url");
  }
  if (loginTitle) {
    return detected(loginReason, "login title");
  }
  if (shortPage) {
    const loginCopy = body.match(/two-step|two step|verification code|authenticator/i);
    if (loginCopy) {
      return detected(loginReason, `login text: ${loginCopy[0]}`);
    }
    if (/\bsign in\b/i.test(body)) {
      const loginDetail = body.match(
        /\b(password|join now|forgot password|email or phone|continue with google)\b/i
      );
      if (loginDetail) {
        return detected(loginReason, `login text: ${loginDetail[0]}`);
      }
    }
  }
  const clear: GateResult = { needed: false, reason: "" };
  return clear;
}

export function looksLikeSend(label: string) {
  return /\b(send|post|publish|invite|connect|inmail)\b/i.test(label);
}

export async function browserNavigate(url: string) {
  return lock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      return {
        blocked: true as const,
        result: "The user has the computer. Wait until they continue.",
      };
    }
    const target = url.startsWith("http") ? url : `https://${url}`;
    await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await session.page.waitForTimeout(400);
    const gate = await looksLikeHumanGate(session.page);
    const snap = await capture(session);
    return { ...snap, gate };
  });
}

async function capture(session: Session) {
  const els = await snapshotPage(session.page, { hideValues: session.mode === "human" });
  session.lastSnapshot = els;
  const title = await session.page.title().catch(() => "");
  const url = session.page.url();
  return { url, title, snapshot: formatSnapshot(url, title, els), gate: { needed: false, reason: "" } };
}

export async function browserElements(): Promise<SnapshotEl[]> {
  return lock(async () => {
    const session = await ensureBrowser();
    await capture(session);
    return session.lastSnapshot;
  });
}

export async function browserPageText(): Promise<string> {
  return lock(async () => {
    const session = await ensureBrowser();
    return session.page.locator("body").innerText();
  });
}

export async function composeDialogText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const EDITABLE_SELECTOR = '[contenteditable="true"], textarea, [role="textbox"]';

    function shadowRoots(root: ParentNode): ShadowRoot[] {
      const found: ShadowRoot[] = [];
      for (const element of root.querySelectorAll("*")) {
        const shadowRoot = element.shadowRoot;
        if (shadowRoot) {
          found.push(shadowRoot);
          found.push(...shadowRoots(shadowRoot));
        }
      }
      return found;
    }

    function textOutsideEditable(element: Element): string {
      let text = "";
      for (const node of element.childNodes) {
        if (node.nodeType === node.TEXT_NODE) {
          text += node.textContent || "";
        } else if (node.nodeType === node.ELEMENT_NODE) {
          const child = node as Element;
          if (!child.matches(EDITABLE_SELECTOR)) text += textOutsideEditable(child);
        }
      }
      return text;
    }

    const roots: ParentNode[] = [document, ...shadowRoots(document)];
    const dialogs = roots.flatMap((root) =>
      [...root.querySelectorAll('[role="dialog"]')].filter((element) =>
        element.querySelector(EDITABLE_SELECTOR)
      )
    );
    if (dialogs.length !== 1) return null;
    return textOutsideEditable(dialogs[0]).replace(/\s+/g, " ").trim();
  });
}

export async function browserComposeText(): Promise<string | null> {
  return lock(async () => {
    const session = await ensureBrowser();
    return composeDialogText(session.page);
  });
}

export async function browserSnapshot() {
  return lock(async () => {
    const session = await ensureBrowser();
    const gate = await looksLikeHumanGate(session.page);
    const snap = await capture(session);
    return { ...snap, gate };
  });
}

export async function browserLook() {
  return lock(async () => {
    const session = await ensureBrowser();
    const gate = await looksLikeHumanGate(session.page);
    const els = await snapshotPage(session.page, { hideValues: session.mode === "human" });
    session.lastSnapshot = els;
    const title = await session.page.title().catch(() => "");
    const url = session.page.url();
    const image = await session.page.screenshot({ type: "jpeg", quality: 55 });
    session.lastShot = image;
    return { url, title, gate, legend: formatLook(els), image: image.toString("base64") };
  });
}

export async function browserClick(opts: { ref?: number; x?: number; y?: number; text?: string }) {
  return lock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      return {
        blocked: true as const,
        result: "The user has the computer. Wait until they continue.",
      };
    }
    let x = opts.x;
    let y = opts.y;
    let label = opts.text || "";
    if (opts.ref != null) {
      const old = session.lastSnapshot.find((e) => e.ref === opts.ref);
      if (!old) {
        await capture(session);
        const retry = session.lastSnapshot.find((e) => e.ref === opts.ref);
        if (!retry) return { blocked: false as const, result: `No element [${opts.ref}]. Take a snapshot first.`, label: "" };
        x = retry.x;
        y = retry.y;
        label = retry.text;
      } else {
        const snap = await capture(session);
        const matches = session.lastSnapshot.filter(
          (e) =>
            e.tag === old.tag &&
            e.role === old.role &&
            e.text === old.text &&
            (old.href ? e.href === old.href : true)
        );
        if (matches.length === 0) {
          return {
            blocked: false as const,
            result: `Not clicked: [${opts.ref}] "${old.text}" is no longer on the page. Take a new snapshot and choose again.\n${snap.snapshot}`,
            label: "",
            ...snap,
          };
        }
        const pick = matches.reduce((nearest, candidate) => {
          const nearestDistance = (nearest.x - old.x) ** 2 + (nearest.y - old.y) ** 2;
          const candidateDistance = (candidate.x - old.x) ** 2 + (candidate.y - old.y) ** 2;
          return candidateDistance < nearestDistance ? candidate : nearest;
        });
        x = pick.x;
        y = pick.y;
        label = pick.text;
      }
    }
    if (x == null || y == null) return { blocked: false as const, result: "Need a ref or x,y.", label: "" };
    await session.page.mouse.click(x, y);
    await session.page.waitForTimeout(350);
    const snap = await capture(session);
    return { blocked: false as const, result: `Clicked ${label || `${x},${y}`}.\n${snap.snapshot}`, label, ...snap };
  });
}

export async function browserType(text: string, ref?: number) {
  return lock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      return { blocked: true as const, result: "The user has the computer. Wait until they continue." };
    }
    if (ref != null) {
      const el = session.lastSnapshot.find((e) => e.ref === ref);
      if (el) {
        await session.page.mouse.click(el.x, el.y);
        await session.page.waitForTimeout(120);
      }
    }
    await session.page.keyboard.type(text, { delay: 15 });
    const snap = await capture(session);
    return { result: `Typed ${text.length} characters.\n${snap.snapshot}`, ...snap };
  });
}

export async function browserPress(key: string) {
  return lock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      return {
        blocked: true as const,
        result: "The user has the computer. Wait until they continue.",
      };
    }
    await session.page.keyboard.press(key);
    await session.page.waitForTimeout(250);
    const snap = await capture(session);
    return { result: `Pressed ${key}.\n${snap.snapshot}`, ...snap };
  });
}

export async function browserScroll(direction: "down" | "up", ref?: number) {
  return lock(async () => {
    const session = await ensureBrowser();
    if (session.mode === "human") {
      return {
        blocked: true as const,
        result: "The user has the computer. Wait until they continue.",
      };
    }
    if (ref != null) {
      let el = session.lastSnapshot.find((entry) => entry.ref === ref);
      if (!el) {
        await capture(session);
        el = session.lastSnapshot.find((entry) => entry.ref === ref);
      }
      if (!el) {
        return {
          blocked: false as const,
          result: `No element [${ref}]. Take a snapshot first.`,
        };
      }
      await session.page.mouse.move(el.x, el.y);
    }
    await session.page.mouse.wheel(0, direction === "down" ? 700 : -700);
    await session.page.waitForTimeout(200);
    const snap = await capture(session);
    return { result: snap.snapshot, ...snap };
  });
}

export async function setBrowserMode(mode: "bot" | "human", reason = "") {
  const session = await ensureBrowser();
  session.mode = mode;
  session.takeoverReason = mode === "human" ? reason : "";
  return browserStatus();
}

export async function humanClick(x: number, y: number) {
  return lock(async () => {
    const session = await ensureBrowser();
    await session.page.mouse.click(x, y);
    return browserStatus();
  });
}

export async function humanNavigate(url: string) {
  return lock(async () => {
    const session = await ensureBrowser();
    const target = url.startsWith("http") ? url : `https://${url}`;
    await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await session.page.waitForTimeout(400);
    return browserStatus();
  });
}

export async function humanType(text: string) {
  return lock(async () => {
    const session = await ensureBrowser();
    await session.page.keyboard.type(text, { delay: 10 });
    return browserStatus();
  });
}

export async function humanPress(key: string) {
  return lock(async () => {
    const session = await ensureBrowser();
    await session.page.keyboard.press(key);
    return browserStatus();
  });
}

export async function closeBrowser() {
  const session = globalThis.__crewBrowser;
  if (session) {
    await session.context.close().catch(() => undefined);
    globalThis.__crewBrowser = undefined;
  }
}
