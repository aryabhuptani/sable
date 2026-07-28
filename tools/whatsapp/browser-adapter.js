"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SELECTORS } = require("./selectors");
const MODERN_CHROME_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

class SelectorDiagnosticError extends Error {
  constructor(message, diagnostic) {
    super(`${message}${diagnostic ? ` Diagnostic: ${diagnostic}` : ""}`);
    this.name = "SelectorDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

class WhatsAppBrowserAdapter {
  constructor({ paths, headless = true, timeoutMs = 60_000, playwright } = {}) {
    this.paths = paths;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.playwright = playwright;
  }

  async connect() {
    const playwright = this.playwright || loadPlaywright();
    this.context = await playwright.chromium.launchPersistentContext(this.paths.profileDir, {
      headless: this.headless,
      timeout: this.timeoutMs,
      args: ["--disable-dev-shm-usage"],
      userAgent: MODERN_CHROME_USER_AGENT,
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
    await this.page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    this.connectionStatus = await this.status();
    return this.connectionStatus;
  }

  async status(timeoutMs = Math.min(this.timeoutMs, 30_000)) {
    const deadline = Date.now() + timeoutMs;
    let readySelector = null;
    let loginSelector = null;
    let unsupportedBrowser = false;
    do {
      readySelector = await firstVisible(this.page, SELECTORS.appReady, 500);
      loginSelector = readySelector ? null : await firstVisible(this.page, SELECTORS.login, 500);
      unsupportedBrowser = Boolean(await this.page.getByText(/WhatsApp works with Google Chrome/i).count().catch(() => 0));
      if (readySelector || loginSelector || unsupportedBrowser) break;
      await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return {
      connected: Boolean(readySelector),
      loginRequired: Boolean(loginSelector),
      unsupportedBrowser: Boolean(unsupportedBrowser),
      readySelector,
      url: this.page.url(),
    };
  }

  async waitUntilReady(timeoutMs = this.timeoutMs) {
    const selector = await firstVisible(this.page, SELECTORS.appReady, timeoutMs);
    if (!selector) throw await this.diagnosticError("WhatsApp Web did not reach the chat list. Complete one-time login with `connect --headless false`.");
    return selector;
  }

  async findAndOpenChat(approved) {
    await this.waitUntilReady();
    const target = String(approved.name || "").trim();
    if (!target) {
      throw new Error(`Approved chat ${approved.id || "(unknown)"} needs an exact name for browser discovery.`);
    }
    const searchSelector = await firstVisible(this.page, SELECTORS.search, 3_000);
    if (!searchSelector) throw await this.diagnosticError("WhatsApp chat search input was not found.");
    const search = this.page.locator(searchSelector).first();
    await search.click();
    await search.fill(target);
    await this.page.waitForTimeout(800);
    const exact = this.page.locator(`#pane-side span[title=${JSON.stringify(target)}]`).first();
    if (await exact.count()) {
      await exact.click();
    } else {
      const resultSelector = await firstVisible(this.page, SELECTORS.searchResults, 2_000);
      if (!resultSelector) throw await this.diagnosticError(`Approved chat was not found by browser search: ${target}`);
      const result = this.page.locator(resultSelector).filter({ hasText: target }).first();
      if (!await result.count()) throw await this.diagnosticError(`No exact approved-chat search result matched: ${target}`);
      await result.click();
    }
    const main = await firstVisible(this.page, SELECTORS.main, 5_000);
    if (!main) throw await this.diagnosticError(`Chat opened but conversation panel was not found: ${target}`);
    const header = await this.page.locator("#main header").first().innerText().catch(() => target);
    const resolvedName = header.split("\n")[0].trim();
    if (resolvedName.localeCompare(target, undefined, { sensitivity: "accent" }) !== 0) {
      throw await this.diagnosticError(`Browser search opened "${resolvedName || "(unknown)"}" instead of approved chat "${target}".`);
    }
    const dataId = await this.page.locator("#main").getAttribute("data-id").catch(() => "");
    return {
      id: approved.id || `name:${target.toLowerCase()}`,
      name: resolvedName || target,
      isGroup: String(approved.id || "").endsWith("@g.us"),
      browserDataId: dataId,
    };
  }

  async readVisibleMessages(chat) {
    const selector = await firstVisible(this.page, SELECTORS.message, 3_000);
    if (!selector) return [];
    return this.page.locator(selector).evaluateAll((nodes, chatId) => nodes.map((node) => {
      const pre = node.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || node.getAttribute("data-pre-plain-text") || "";
      const textNode = node.querySelector("[data-testid='selectable-text']") || node.querySelector(".selectable-text");
      const image = node.querySelector("img[src], video, audio");
      const documentNode = node.querySelector("[data-testid*='document'], a[download]");
      const attachment = image || documentNode ? {
        type: node.querySelector("video") ? "video" : node.querySelector("audio") ? "audio" : documentNode ? "document" : "image",
        filename: documentNode?.getAttribute("download") || documentNode?.textContent?.trim() || "",
        mimeType: "",
        sizeBytes: null,
        caption: textNode?.textContent?.trim() || "",
      } : null;
      return {
        id: node.getAttribute("data-id") || node.closest("[data-id]")?.getAttribute("data-id") || "",
        chatId,
        prePlainText: pre,
        timestamp: node.querySelector("[data-testid='msg-meta']")?.textContent || "",
        sender: "",
        fromMe: /message-out/.test(node.className) || Boolean(node.closest("[data-testid='msg-container']")?.querySelector("[data-icon='msg-dblcheck']")),
        text: textNode?.textContent?.trim() || "",
        attachment,
      };
    }), chat.id);
  }

  async scrollHistoryUp() {
    const selector = await firstVisible(this.page, SELECTORS.scroller, 2_000);
    if (!selector) throw await this.diagnosticError("Conversation history scroller was not found.");
    const beforeIds = await this.page.locator(SELECTORS.message.join(",")).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-id") || "").filter(Boolean)
    ).catch(() => []);
    const result = await this.page.locator(selector).first().evaluate((element) => {
      const before = element.scrollTop;
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { before, after: element.scrollTop, height: element.scrollHeight };
    });
    await this.page.waitForFunction(
      ({ selectors, previous }) => {
        const nodes = [...document.querySelectorAll(selectors)];
        const ids = nodes.map((node) => node.getAttribute("data-id") || "").filter(Boolean);
        return ids.some((id) => !previous.includes(id));
      },
      { selectors: SELECTORS.message.join(","), previous: beforeIds },
      { timeout: Math.min(this.timeoutMs, 3_000) }
    ).catch(() => this.page.waitForTimeout(500));
    return result;
  }

  async diagnosticError(message) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshot = path.join(this.paths.artifactsDir, `selector-failure-${stamp}.png`);
    const html = path.join(this.paths.artifactsDir, `selector-failure-${stamp}.html`);
    fs.mkdirSync(this.paths.artifactsDir, { recursive: true, mode: 0o700 });
    await this.page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    const content = await this.page.content().catch(() => "");
    fs.writeFileSync(html, content, "utf8");
    fs.writeFileSync(path.join(this.paths.artifactsDir, `selector-failure-${stamp}.json`), `${JSON.stringify({
      message, url: this.page.url(), selectors: SELECTORS, screenshot, html,
    }, null, 2)}\n`, "utf8");
    for (const filePath of [screenshot, html, path.join(this.paths.artifactsDir, `selector-failure-${stamp}.json`)]) {
      try { fs.chmodSync(filePath, 0o600); } catch {}
    }
    return new SelectorDiagnosticError(message, screenshot);
  }

  async captureArtifact(prefix = "whatsapp-login") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshot = path.join(this.paths.artifactsDir, `${prefix}-${stamp}.png`);
    const html = path.join(this.paths.artifactsDir, `${prefix}-${stamp}.html`);
    fs.mkdirSync(this.paths.artifactsDir, { recursive: true, mode: 0o700 });
    await this.page.screenshot({ path: screenshot, fullPage: true });
    fs.writeFileSync(html, await this.page.content(), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(screenshot, 0o600);
    return { screenshot, html };
  }

  async close() { if (this.context) await this.context.close(); }
}

async function firstVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false)) return selector;
    }
    await page.waitForTimeout(Math.min(100, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  return null;
}

function loadPlaywright() {
  try { return require("playwright"); }
  catch { throw new Error("playwright is required for live WhatsApp access. Run `npm install` then `npx playwright install chromium`."); }
}

module.exports = { MODERN_CHROME_USER_AGENT, SelectorDiagnosticError, WhatsAppBrowserAdapter, firstVisible, loadPlaywright };
