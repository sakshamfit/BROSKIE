import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INBOX_FILTERS,
  INBOX_LABELS,
  filterInboxChats,
  filterInboxRequests,
  filterSearchMessages,
  inboxCounts,
  isDirectInboxChat,
  isInboxFilter,
} from './chatInbox.js';

const chats = [
  { id: 'r1', name: 'Rahul', type: 'direct', archived: false },
  { id: 'a1', name: 'Old Conversation', type: 'direct', archived: true },
  { id: 'g1', name: 'Campus GC', type: 'gc', archived: false },
  { id: 'g2', name: 'Archived GC', type: 'gc', archived: true },
  { id: 'r2', name: 'Aman', type: 'group', archived: false },
];

const requests = [
  { chatId: 'req1', requester: { name: 'Sakshi', username: 'sakshi' }, chat: { lastMessage: { body: 'Wants to chat' } } },
  { chatId: 'req2', requester: { name: 'Vikram', username: 'vik' }, chat: { lastMessage: { body: 'Hey there' } } },
];

describe('chat inbox filters', () => {
  it('recognizes the three inbox options', () => {
    assert.equal(isInboxFilter('recent'), true);
    assert.equal(isInboxFilter('archived'), true);
    assert.equal(isInboxFilter('requests'), true);
    assert.equal(isInboxFilter('gc'), false);
    assert.equal(INBOX_LABELS.recent, 'Recent Chat');
    assert.equal(INBOX_LABELS.archived, 'Archived Chat');
    assert.equal(INBOX_LABELS.requests, 'Request Chat');
  });

  it('never treats GC rows as inbox chats', () => {
    assert.equal(isDirectInboxChat({ type: 'gc' }), false);
    assert.equal(isDirectInboxChat({ type: 'direct' }), true);
    assert.equal(isDirectInboxChat({ type: 'group' }), true);
  });

  it('Recent Chat excludes archived chats and every GC', () => {
    const visible = filterInboxChats(chats, INBOX_FILTERS.recent);
    assert.deepEqual(visible.map((c) => c.id), ['r1', 'r2']);
  });

  it('Archived Chat excludes recent chats and every GC', () => {
    const visible = filterInboxChats(chats, INBOX_FILTERS.archived);
    assert.deepEqual(visible.map((c) => c.id), ['a1']);
  });

  it('switching filters does not mutate the source list', () => {
    const snapshot = JSON.stringify(chats);
    filterInboxChats(chats, INBOX_FILTERS.archived);
    filterInboxChats(chats, INBOX_FILTERS.recent);
    assert.equal(JSON.stringify(chats), snapshot);
  });

  it('search stays inside the selected category', () => {
    assert.deepEqual(filterInboxChats(chats, 'recent', 'rahul').map((c) => c.id), ['r1']);
    assert.deepEqual(filterInboxChats(chats, 'archived', 'rahul').map((c) => c.id), []);
    assert.deepEqual(filterInboxChats(chats, 'archived', 'old').map((c) => c.id), ['a1']);
    assert.deepEqual(filterInboxRequests(requests, 'sakshi').map((r) => r.chatId), ['req1']);
    assert.deepEqual(filterInboxRequests(requests, 'hey').map((r) => r.chatId), ['req2']);
    assert.deepEqual(filterInboxRequests(requests, 'rahul').map((r) => r.chatId), []);
  });

  it('counts come from real lists and ignore GCs', () => {
    assert.deepEqual(inboxCounts(chats, requests), { recent: 2, archived: 1, requests: 2 });
    assert.deepEqual(inboxCounts([], []), { recent: 0, archived: 0, requests: 0 });
  });

  it('message search never mixes categories or GCs', () => {
    const messages = [
      { id: 'm1', chatId: 'r1', body: 'hey' },
      { id: 'm2', chatId: 'a1', body: 'old' },
      { id: 'm3', chatId: 'g1', body: 'gc ping' },
    ];
    assert.deepEqual(filterSearchMessages(messages, chats, 'recent').map((m) => m.id), ['m1']);
    assert.deepEqual(filterSearchMessages(messages, chats, 'archived').map((m) => m.id), ['m2']);
    assert.deepEqual(filterSearchMessages(messages, chats, 'requests').map((m) => m.id), []);
  });
});
