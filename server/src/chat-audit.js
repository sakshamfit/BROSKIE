#!/usr/bin/env node
/**
 * Read-only chat-history audit.
 *
 * This intentionally does NOT import ./db: importing db.js applies additive
 * migrations. Instead it opens the existing SQLite file with readonly and
 * query_only enabled, so operators can compare stored history with the Chats
 * API criteria before changing or recovering anything.
 *
 * Usage:
 *   npm run audit:chats -- --username alice
 *   npm run audit:chats -- --user-id abc123
 *   DATA_DIR=/mounted/volume npm run audit:chats -- --username alice
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(__dirname, '..', 'data');
const databasePath = path.join(DATA_DIR, 'tomodachi.db');

if (!fs.existsSync(databasePath)) {
  console.error(`No database found at ${databasePath}. Nothing was created or modified.`);
  process.exit(2);
}

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

try {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  );
  const required = ['users', 'chats', 'chat_members', 'messages'];
  const missing = required.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`Missing required table(s): ${missing.join(', ')}`);

  const count = (table) => db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
  const report = {
    mode: 'read-only',
    databasePath,
    totals: {
      users: count('users'),
      conversations: count('chats'),
      memberships: count('chat_members'),
      messages: count('messages'),
    },
    foreignKeyViolations: db.pragma('foreign_key_check').length,
  };

  const userIdArg = argument('--user-id');
  const usernameArg = argument('--username');
  let user = null;
  if (userIdArg) {
    user = db.prepare('SELECT id, username, name FROM users WHERE id = ?').get(userIdArg);
  } else if (usernameArg) {
    const key = String(usernameArg).trim().normalize('NFKC').toLowerCase();
    const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
    user = userColumns.has('username_key')
      ? db.prepare('SELECT id, username, name FROM users WHERE username_key = ?').get(key)
      : db.prepare('SELECT id, username, name FROM users WHERE lower(trim(username)) = ?').get(key);
  }

  if (userIdArg || usernameArg) {
    if (!user) throw new Error('Requested user was not found');

    const conversations = db.prepare(
      `SELECT
         c.id,
         c.type,
         c.created_at createdAt,
         c.updated_at updatedAt,
         cm.cleared_at clearedAt,
         cr.status requestStatus,
         cr.sender_id requestSenderId,
         cr.receiver_id requestReceiverId,
         (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) messageCount,
         (SELECT COUNT(*) FROM messages m
            WHERE m.chat_id = c.id AND m.created_at > COALESCE(cm.cleared_at, 0)) visibleMessageCount,
         (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id) lastMessageAt
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN chat_requests cr ON cr.chat_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.updated_at DESC`
    ).all(user.id);

    const returnedIds = new Set(db.prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       LEFT JOIN chat_requests cr ON cr.chat_id = c.id
       WHERE cm.user_id = ?
         AND (cr.chat_id IS NULL OR cr.status != 'pending' OR cr.receiver_id != ?)
         AND (
           EXISTS (
             SELECT 1 FROM messages visible_message
             WHERE visible_message.chat_id = c.id
               AND visible_message.created_at > COALESCE(cm.cleared_at, 0)
           )
           OR (
             cm.cleared_at IS NULL
             AND (
               c.type != 'direct'
               OR cr.status = 'accepted'
               OR EXISTS (SELECT 1 FROM messages history_message WHERE history_message.chat_id = c.id)
               OR c.updated_at > c.created_at
               OR c.created_by = ?
               OR (cr.status = 'pending' AND cr.sender_id = ?)
             )
           )
         )`
    ).all(user.id, user.id, user.id, user.id).map((row) => row.id));

    const peersByChat = new Map();
    db.prepare(
      `SELECT cm.chat_id chatId, u.id, u.username, u.name
       FROM chat_members mine
       JOIN chat_members cm ON cm.chat_id = mine.chat_id AND cm.user_id != mine.user_id
       JOIN users u ON u.id = cm.user_id
       WHERE mine.user_id = ?
       ORDER BY cm.joined_at`
    ).all(user.id).forEach((peer) => {
      const list = peersByChat.get(peer.chatId) || [];
      list.push({ id: peer.id, username: peer.username, name: peer.name });
      peersByChat.set(peer.chatId, list);
    });

    report.user = user;
    report.userHistory = {
      databaseConversationCount: conversations.length,
      returnedByChatsQueryCount: returnedIds.size,
      totalMessagesAcrossConversations: conversations.reduce((sum, chat) => sum + chat.messageCount, 0),
      conversations: conversations.map((conversation) => ({
        ...conversation,
        returnedByChatsQuery: returnedIds.has(conversation.id),
        participants: peersByChat.get(conversation.id) || [],
      })),
    };
  }

  const backupDir = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
  report.recovery = {
    backupDir,
    backups: fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter((name) => name.endsWith('.db')).sort().reverse()
      : [],
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
