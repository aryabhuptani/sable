"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 3;

class WhatsAppStore {
  constructor(databasePath) {
    this.databasePath = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    try { fs.chmodSync(databasePath, 0o600); } catch {}
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const current = Number(this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value || 0);
    if (current < 1) this.db.exec(`
      CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_group INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 1, last_message_at TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, sender TEXT, from_me INTEGER NOT NULL DEFAULT 0, timestamp TEXT, text TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'text', raw_json TEXT, indexed_at TEXT NOT NULL);
      CREATE INDEX messages_chat_time ON messages(chat_id, timestamp DESC);
      CREATE TABLE attachments (message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, type TEXT, filename TEXT, mime_type TEXT, size_bytes INTEGER, caption TEXT);
      CREATE TABLE sync_checkpoints (chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, oldest_message_id TEXT, oldest_timestamp TEXT, newest_message_id TEXT, newest_timestamp TEXT, completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    `);
    if (current < 2) {
      try {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(message_id UNINDEXED, chat_id UNINDEXED, text, sender)");
        this.ftsAvailable = true;
      } catch { this.ftsAvailable = false; }
    } else {
      this.ftsAvailable = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='messages_fts'").get());
    }
    if (current < 3) this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        chats_ok INTEGER NOT NULL DEFAULT 0,
        chats_failed INTEGER NOT NULL DEFAULT 0,
        messages_seen INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
    `);
    this.db.prepare("INSERT INTO schema_meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SCHEMA_VERSION));
  }

  upsertChat(chat) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO chats(id,name,is_group,approved,last_message_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_group=excluded.is_group,approved=excluded.approved,last_message_at=COALESCE(excluded.last_message_at,chats.last_message_at),updated_at=excluded.updated_at`)
      .run(chat.id, chat.name || chat.id, chat.isGroup ? 1 : 0, chat.approved === false ? 0 : 1, chat.lastMessageAt || null, now);
  }

  upsertMessages(chat, messages) {
    this.upsertChat(chat);
    const upsert = this.db.prepare(`INSERT INTO messages(id,chat_id,sender,from_me,timestamp,text,kind,raw_json,indexed_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET sender=excluded.sender,from_me=excluded.from_me,timestamp=excluded.timestamp,text=excluded.text,kind=excluded.kind,raw_json=excluded.raw_json,indexed_at=excluded.indexed_at`);
    const attachment = this.db.prepare(`INSERT INTO attachments(message_id,type,filename,mime_type,size_bytes,caption) VALUES(?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET type=excluded.type,filename=excluded.filename,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,caption=excluded.caption`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const message of messages) {
        const now = new Date().toISOString();
        upsert.run(message.id, chat.id, message.sender || "", message.fromMe ? 1 : 0, message.timestamp, message.text || "", message.kind || "text", JSON.stringify(message), now);
        if (message.attachment) attachment.run(message.id, message.attachment.type, message.attachment.filename, message.attachment.mimeType, message.attachment.sizeBytes, message.attachment.caption);
        if (this.ftsAvailable) {
          this.db.prepare("DELETE FROM messages_fts WHERE message_id=?").run(message.id);
          this.db.prepare("INSERT INTO messages_fts(message_id,chat_id,text,sender) VALUES(?,?,?,?)").run(message.id, chat.id, message.text || "", message.sender || "");
        }
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return messages.length;
  }

  checkpoint(chatId, value) {
    this.db.prepare(`INSERT INTO sync_checkpoints(chat_id,oldest_message_id,oldest_timestamp,newest_message_id,newest_timestamp,completed,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET oldest_message_id=excluded.oldest_message_id,oldest_timestamp=excluded.oldest_timestamp,newest_message_id=excluded.newest_message_id,newest_timestamp=excluded.newest_timestamp,completed=excluded.completed,updated_at=excluded.updated_at`)
      .run(chatId, value.oldestMessageId || null, value.oldestTimestamp || null, value.newestMessageId || null, value.newestTimestamp || null, value.completed ? 1 : 0, new Date().toISOString());
  }
  getCheckpoint(chatId) { return this.db.prepare("SELECT * FROM sync_checkpoints WHERE chat_id=?").get(chatId) || null; }
  beginSyncRun() {
    return Number(this.db.prepare("INSERT INTO sync_runs(started_at,status) VALUES(?,?)").run(new Date().toISOString(), "running").lastInsertRowid);
  }
  finishSyncRun(id, { status, chatsOk = 0, chatsFailed = 0, messagesSeen = 0, error = null }) {
    this.db.prepare("UPDATE sync_runs SET finished_at=?,status=?,chats_ok=?,chats_failed=?,messages_seen=?,error=? WHERE id=?")
      .run(new Date().toISOString(), status, chatsOk, chatsFailed, messagesSeen, error, id);
  }
  latestSyncRun() {
    return this.db.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").get() || null;
  }
  listChats() { return this.db.prepare("SELECT c.*,COUNT(m.id) AS message_count FROM chats c LEFT JOIN messages m ON m.chat_id=c.id WHERE c.approved=1 GROUP BY c.id ORDER BY COALESCE(c.last_message_at,'') DESC,c.name").all(); }
  search(query, { chatId, limit = 50 } = {}) {
    if (!String(query || "").trim()) return [];
    if (this.ftsAvailable) {
      const where = chatId ? "AND m.chat_id=?" : "";
      const params = chatId ? [query, chatId, limit] : [query, limit];
      try {
        return this.db.prepare(`SELECT m.*,c.name AS chat_name,a.type AS attachment_type,a.filename,a.mime_type,a.size_bytes,a.caption FROM messages_fts f JOIN messages m ON m.id=f.message_id JOIN chats c ON c.id=m.chat_id LEFT JOIN attachments a ON a.message_id=m.id WHERE messages_fts MATCH ? ${where} ORDER BY rank LIMIT ?`).all(...params);
      } catch (error) {
        throw new Error(`Invalid SQLite FTS query: ${error.message}. Quote phrases containing punctuation.`);
      }
    }
    const where = chatId ? "AND m.chat_id=?" : "";
    const params = chatId ? [`%${query}%`, chatId, limit] : [`%${query}%`, limit];
    return this.db.prepare(`SELECT m.*,c.name AS chat_name,a.type AS attachment_type,a.filename,a.mime_type,a.size_bytes,a.caption FROM messages m JOIN chats c ON c.id=m.chat_id LEFT JOIN attachments a ON a.message_id=m.id WHERE m.text LIKE ? ${where} ORDER BY m.timestamp DESC LIMIT ?`).all(...params);
  }
  messagesForChat(chatId) { return this.db.prepare("SELECT m.*,a.type AS attachment_type,a.filename,a.mime_type,a.size_bytes,a.caption FROM messages m LEFT JOIN attachments a ON a.message_id=m.id WHERE m.chat_id=? ORDER BY m.timestamp,m.id").all(chatId); }
  schemaVersion() { return Number(this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value); }
  close() { this.db.close(); }
}

module.exports = { SCHEMA_VERSION, WhatsAppStore };
