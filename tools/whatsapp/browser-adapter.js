"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SELECTORS } = require("./selectors");

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
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(this.timeoutMs);
    await this.page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: this.timeoutMs });
    return this.status();
  }

  async status() {
    const readySelector = await firstVisible(this.page, SELECTORS.appReady, 2_000);
    const loginSelector = readySelector ? null : await firstVisible(this.page, SELECTORS.login, 1_000);
    return { connected: Boolean(readySelector), loginRequired: Boolean(loginSelector), readySelector, url: this.page.url() };
  }

  async waitUntilReady(timeoutMs = this.timeoutMs) {
    const selector = await firstVisible(this.page, SELECTORS.appReady, timeoutMs);
    if (!selector) throw await this.diagnosticError("WhatsApp Web did not reach the chat list. Complete one-time login with `connect --headless false`.");
    return selector;
  }

  async findAndOpenChat(approved) {
    await this.waitUntilReady();
    const target = approved.name || approved.id;
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
    const dataId = await this.page.locator("#main").getAttribute("data-id").catch(() => "");
    return { id: approved.id || `name:${target.toLowerCase()}`, name: header.split("\n")[0].trim() || target, isGroup: false, browserDataId: dataId };
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
    return this.page.locator(selector).first().evaluate((element) => {
      const before = element.scrollTop;
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return { before, after: element.scrollTop, height: element.scrollHeight };
    });
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
    return new SelectorDiagnosticError(message, screenshot);
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

module.exports = { SelectorDiagnosticError, WhatsAppBrowserAdapter, firstVisible, loadPlaywright };
