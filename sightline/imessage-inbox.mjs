/**
 * Poll Shared-line inbound iMessage and answer from archived FaceTime sessions
 * (local data/facetime-sessions.json — not live FaceTime memory).
 *
 *   npm run imessage:inbox
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendLargeTextImessage } from './imessage.mjs';
import { searchPastSessions } from './session-memory.mjs';
import { classifyTurn } from './turn-intent.mjs';

const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url));
const SEEN_PATH = join(MODULE_DIR, 'data', 'imessage-seen.json');
const POLL_MS = Number(process.env.IMESSAGE_INBOX_POLL_MS || 4000);
const API_BASE = (process.env.CHERT_API_BASE || 'https://app.trychert.com').replace(/\/$/, '');

function filled(v) {
  return Boolean(v && String(v).trim() && !/YOUR_/.test(v));
}

function authHeaders() {
  const key = process.env.CHERT_API_KEY || process.env.CHERT_FACETIME_API_KEY || '';
  const pid = process.env.CHERT_PROJECT_ID || '';
  if (!filled(key) || !filled(pid)) throw new Error('Need CHERT_API_KEY + CHERT_PROJECT_ID');
  return {
    Authorization: `Bearer ${key.trim()}`,
    'X-Chert-Project-Id': pid.trim(),
  };
}

function lineId() {
  for (const name of ['CHERT_LINE_ID', 'CHERT_PHONE_LINE_ID', 'CHERT_SHARED_LINE_ID']) {
    if (filled(process.env[name])) return process.env[name].trim();
  }
  return '';
}

function loadSeen() {
  try {
    if (!existsSync(SEEN_PATH)) return { ids: [] };
    return JSON.parse(readFileSync(SEEN_PATH, 'utf8')) || { ids: [] };
  } catch {
    return { ids: [] };
  }
}

function saveSeen(ids) {
  mkdirSync(dirname(SEEN_PATH), { recursive: true });
  writeFileSync(SEEN_PATH, `${JSON.stringify({ ids: ids.slice(-200) }, null, 2)}\n`);
}

async function fetchSharedMessages() {
  const res = await fetch(`${API_BASE}/api/v1/shared-messages?limit=50`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`shared-messages GET HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  if (Array.isArray(body?.data?.items)) return body.data.items;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body)) return body;
  return [];
}

function messageId(msg) {
  return String(msg.id || msg.message_id || msg.data?.id || '');
}

function messageText(msg) {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.body === 'string') return msg.body;
  const parts = msg.parts || msg.message?.parts || [];
  return parts
    .filter(p => p?.type === 'text' || typeof p?.value === 'string')
    .map(p => p.value || p.text || '')
    .join(' ')
    .trim();
}

function isInbound(msg) {
  const dir = String(msg.direction || msg.data?.direction || '').toLowerCase();
  if (dir === 'inbound' || dir === 'received') return true;
  if (dir === 'outbound' || dir === 'sent') return false;
  const from = String(msg.from || msg.sender || msg.sender_handle?.handle || '');
  const to = String(msg.to || msg.recipient || '');
  const mine = process.env.CHERT_IMESSAGE_TO || '';
  if (mine && from.replace(/\D/g, '') === mine.replace(/\D/g, '')) return false;
  if (mine && to.replace(/\D/g, '') === mine.replace(/\D/g, '')) return true;
  return Boolean(msg.is_inbound ?? msg.inbound);
}

/** Past FaceTime reads for this question (cross-session, for iMessage only). */
function memoryForQuestion(question) {
  return searchPastSessions(question, { maxReads: 6 });
}

async function answerFromMemory(question, memoryText) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || /YOUR_/.test(key)) {
    return memoryText
      ? `From a past FaceTime read: ${memoryText.slice(0, 500)}`
      : 'I do not have a FaceTime reading saved yet. Call Argo, show the label, then text me again.';
  }
  const model = process.env.GEMINI_LLM_MODEL || 'gemini-3.5-flash-lite';
  const prompt =
    `You are Argo texting over iMessage for a low-vision user.\n` +
    `Reply in one or two short plain sentences. No markdown. Never say "okay".\n` +
    `You can send large-text images when asked — never claim you cannot send images or texts.\n` +
    `They asked: "${question}".\n` +
    `Past FaceTime readings (may span several calls):\n"""\n${memoryText || '(none)'}\n"""\n` +
    `Only use facts from those readings. If none match, say you do not see that in past FaceTime reads.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 180 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `Gemini HTTP ${res.status}`);
  }
  return (
    (body?.candidates?.[0]?.content?.parts || [])
      .map(p => p.text)
      .filter(Boolean)
      .join(' ')
      .trim() || 'I could not answer that just now.'
  );
}

async function sendTextReply(text) {
  const phone = process.env.CHERT_IMESSAGE_TO;
  const lid = lineId();
  if (!filled(phone) || !lid) throw new Error('Need CHERT_IMESSAGE_TO + CHERT_LINE_ID');
  const res = await fetch(`${API_BASE}/api/v1/shared-messages`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ line_id: lid, recipient: phone, text }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`reply HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

/**
 * @param {string} text
 * @param {string} memoryText
 */
async function handleInbound(text, memoryText) {
  const turn = classifyTurn(text, memoryText);
  if (turn.intent === 'ack' || turn.intent === 'noop' || turn.intent === 'stop') {
    return { replied: false, intent: turn.intent };
  }
  if (turn.intent === 'help' || turn.intent === 'zoom') {
    const msg =
      turn.intent === 'zoom'
        ? 'Open the last image I sent and pinch to zoom. Or text "send it" and I will resend the large text.'
        : 'After FaceTime with Argo, text questions like "what was the sodium?" or "send it" for the large-text image. Say cream, yellow, white, or dark to change contrast.';
    await sendTextReply(msg);
    return { replied: true, intent: turn.intent };
  }
  if (turn.intent === 'resend' || turn.intent === 'theme_sample') {
    if (!memoryText) {
      await sendTextReply('I have not saved a FaceTime reading yet. Call Argo first, then text me.');
      return { replied: true, intent: turn.intent };
    }
    if (turn.theme) {
      const { setThemePreference } = await import('./theme-pref.mjs');
      setThemePreference(turn.theme);
    }
    // Resend the best-matching past read (or most recent chunk).
    const blob = memoryText.split(/\n\n+/).slice(0, 1).join('\n\n') || memoryText;
    await sendLargeTextImessage({
      text: blob.replace(/^Session[^\n]*\n?/, '').trim() || blob,
      caption:
        turn.intent === 'theme_sample'
          ? `Argo — ${turn.spoken}. Pinch to zoom.`
          : 'Argo large text — from a past FaceTime read. Pinch to zoom.',
      theme: turn.theme,
    });
    return { replied: true, intent: turn.intent };
  }
  if (turn.intent === 'theme_list') {
    await sendTextReply('Say cream, yellow, white, or dark.');
    return { replied: true, intent: 'theme_list' };
  }

  if (!memoryText) {
    await sendTextReply(
      'I do not have FaceTime reading saved yet. FaceTime Argo, show the label, then ask me here.',
    );
    return { replied: true, intent: 'no_memory' };
  }
  const answer = await answerFromMemory(text, memoryText);
  await sendTextReply(answer);
  return { replied: true, intent: 'memory_answer', answer };
}

async function tick(seen) {
  const list = await fetchSharedMessages();
  const rows = Array.isArray(list) ? list : [];
  const inbound = rows
    .filter(m => isInbound(m) && messageText(m) && messageId(m))
    .sort((a, b) =>
      String(a.sent_at || a.created_at || '').localeCompare(String(b.sent_at || b.created_at || '')),
    );

  for (const msg of inbound) {
    const id = messageId(msg);
    if (!id || seen.ids.includes(id)) continue;
    const text = messageText(msg);
    const found = memoryForQuestion(text);
    console.log('[inbox] inbound', {
      id,
      text: text.slice(0, 80),
      hasMemory: Boolean(found.text),
      sessions: found.sessionCount,
      reads: found.readCount,
    });
    try {
      const result = await handleInbound(text, found.text);
      console.log('[inbox] handled', result);
    } catch (error) {
      console.error('[inbox] handle failed', error);
      try {
        await sendTextReply('Sorry — I hit a snag answering that. Try again in a moment.');
      } catch {
        /* ignore */
      }
    }
    seen.ids.push(id);
    saveSeen(seen.ids);
  }
}

async function main() {
  if (!lineId() || !filled(process.env.CHERT_IMESSAGE_TO)) {
    throw new Error('Set CHERT_LINE_ID and CHERT_IMESSAGE_TO before starting the inbox poller');
  }
  const seen = loadSeen();
  console.log('[inbox] polling shared-messages every', POLL_MS, 'ms');
  try {
    const list = await fetchSharedMessages();
    for (const msg of Array.isArray(list) ? list : []) {
      const id = messageId(msg);
      if (id && isInbound(msg) && !seen.ids.includes(id)) seen.ids.push(id);
    }
    saveSeen(seen.ids);
    console.log('[inbox] seeded', seen.ids.length, 'seen ids');
  } catch (error) {
    console.warn('[inbox] seed failed (will still poll):', String(error?.message || error));
  }

  for (;;) {
    try {
      await tick(seen);
    } catch (error) {
      console.error('[inbox] tick error', error);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error('[inbox] fatal', error);
    process.exit(1);
  });
}

export { handleInbound, memoryForQuestion };
