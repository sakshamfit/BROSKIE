/**
 * Chat inbox filter helpers.
 *
 * Recent / Archived / Request Chat are views over the EXISTING chat system.
 * Switching a filter never archives, unarchives, accepts, or declines anything.
 * GC conversations are excluded from every inbox category.
 */

export const INBOX_FILTERS = {
  recent: 'recent',
  archived: 'archived',
  requests: 'requests',
};

export const INBOX_LABELS = {
  recent: 'Recent Chat',
  archived: 'Archived Chat',
  requests: 'Request Chat',
};

export const INBOX_EMPTY = {
  recent: {
    icon: 'chatbubbles-outline',
    title: 'No recent chats yet.',
    subtitle: 'Tap find +ones to start a conversation.',
  },
  archived: {
    icon: 'archive-outline',
    title: 'No archived chats.',
    subtitle: 'Long-press a chat to archive it.',
  },
  requests: {
    icon: 'mail-unread-outline',
    title: 'No chat requests.',
    subtitle: 'New messages from people outside your contacts will appear here.',
  },
};

export function isInboxFilter(value) {
  return value === INBOX_FILTERS.recent
    || value === INBOX_FILTERS.archived
    || value === INBOX_FILTERS.requests;
}

export function isDirectInboxChat(chat) {
  return !!chat && chat.type !== 'gc';
}

export function filterInboxChats(chats, filter, query = '') {
  const list = Array.isArray(chats) ? chats : [];
  const q = String(query || '').trim().toLowerCase();
  const wantArchived = filter === INBOX_FILTERS.archived;
  const base = list.filter((chat) => isDirectInboxChat(chat) && (wantArchived ? !!chat.archived : !chat.archived));
  if (!q) return base;
  return base.filter((chat) => String(chat.name || '').toLowerCase().includes(q));
}

export function filterInboxRequests(requests, query = '') {
  const list = Array.isArray(requests) ? requests : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((item) => {
    const name = item?.requester?.name || item?.chat?.name || '';
    const username = item?.requester?.username || '';
    const body = item?.chat?.lastMessage?.body || '';
    return name.toLowerCase().includes(q)
      || username.toLowerCase().includes(q)
      || body.toLowerCase().includes(q);
  });
}

export function inboxCounts(chats, requests) {
  const list = Array.isArray(chats) ? chats : [];
  const reqs = Array.isArray(requests) ? requests : [];
  const direct = list.filter(isDirectInboxChat);
  return {
    recent: direct.filter((chat) => !chat.archived).length,
    archived: direct.filter((chat) => !!chat.archived).length,
    requests: reqs.length,
  };
}

/** Message-search hits must stay inside the selected inbox category. */
export function filterSearchMessages(messages, chats, filter) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (filter === INBOX_FILTERS.requests) return [];
  const list = Array.isArray(chats) ? chats : [];
  const allowed = new Set(
    list
      .filter((chat) => isDirectInboxChat(chat) && (filter === INBOX_FILTERS.archived ? !!chat.archived : !chat.archived))
      .map((chat) => chat.id),
  );
  return msgs.filter((message) => allowed.has(message.chatId));
}
