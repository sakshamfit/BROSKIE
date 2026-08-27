import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'store');
const chatContextSrc = readFileSync(join(root, 'ChatContext.js'), 'utf8');

test('voice/video default routing is split by call type instead of hardcoded speaker-on', () => {
  if (/RTC\.setSpeakerphoneOn\(true\)/.test(chatContextSrc)) {
    throw new Error('Call setup still hardcodes speakerphone on.');
  }
  if (!/Platform\.OS === 'web' \? true : type === 'video'/.test(chatContextSrc)) {
    throw new Error('Call setup no longer distinguishes native voice (earpiece) from video (speaker).');
  }
});

test('connected calls re-apply the current audio route after connect/reconnect', () => {
  if (!/pc\.connectionState === 'connected'\) applySpeakerRoute\(speakerOnRef\.current\)/.test(chatContextSrc)) {
    throw new Error('The current route is not re-applied on peer connection.');
  }
  if (!/state === 'connected' \|\| state === 'completed'\) applySpeakerRoute\(speakerOnRef\.current\)/.test(chatContextSrc)) {
    throw new Error('The current route is not re-applied on ICE reconnect.');
  }
});

test('manual speaker toggle still drives the same route helper both directions', () => {
  if (!/speakerOnRef\.current = next;[\s\S]*setSpeakerOn\(next\);[\s\S]*applySpeakerRoute\(next\);/.test(chatContextSrc)) {
    throw new Error('Speaker toggle no longer updates state/ref and re-applies the chosen route.');
  }
});
