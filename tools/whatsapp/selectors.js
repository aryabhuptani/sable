"use strict";

// Prefer roles, stable ids, and data attributes. Generated class names are deliberately absent.
const SELECTORS = Object.freeze({
  appReady: ["#pane-side", "[aria-label='Chat list']", "[role='grid'][aria-label]"],
  login: ["canvas[aria-label*='Scan']", "[data-ref]", "text=Link with phone number"],
  search: [
    "[data-testid='chat-list-search-container'] input[role='textbox']",
    "input[aria-label='Search or start a new chat']",
    "#side [contenteditable='true'][role='textbox']",
    "[aria-label='Search input textbox']",
    "[contenteditable='true'][data-tab='3']",
  ],
  searchResults: ["#pane-side [role='listitem']", "#pane-side [role='row']", "#pane-side span[title]"],
  main: ["#main"],
  message: ["#main [data-id]", "#main [data-testid='msg-container']", "#main [role='row'] [data-pre-plain-text]"],
  documentMessage: ["#main [data-id]:has([data-testid*='document'])", "#main [data-testid='msg-container']:has([data-icon='document'])", "#main [data-id]:has(a[download])"],
  documentDownload: ["[data-icon='download']", "[aria-label='Download']", "a[download]"],
  scroller: ["#main [data-testid='conversation-panel-messages']", "#main [role='application']", "#main .copyable-area"],
});

module.exports = { SELECTORS };
