/**
 * FaceTime call memory: blank slate per call for the live agent; archived
 * sessions for later iMessage recall ("what was the sodium?", "that ingredient").
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'data', 'facetime-sessions.json');
const MAX_SESSIONS = 40;
const MAX_READS_PER_SESSION = 12;

/**
 * @typedef {{ n: number, fullText: string, summary: string, at: string }} SessionRead
 * @typedef {{ id: string, startedAt: string, endedAt: string | null, reads: SessionRead[] }} FaceTimeSession
 */

function loadStore() {
  try {
    if (!existsSync(STORE_PATH)) return { sessions: /** @type {FaceTimeSession[]} */ ([]) };
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    return { sessions: Array.isArray(raw?.sessions) ? raw.sessions : [] };
  } catch {
    return { sessions: [] };
  }
}

/**
 * @param {{ sessions: FaceTimeSession[] }} store
 */
function saveStore(store) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const sessions = store.sessions.slice(-MAX_SESSIONS);
  writeFileSync(STORE_PATH, `${JSON.stringify({ sessions }, null, 2)}\n`);
}

/**
 * Fresh in-call memory for one FaceTime job. Does not load past calls.
 */
export function createCallMemory() {
  /** @type {FaceTimeSession} */
  const session = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    reads: [],
  };
  let n = 0;

  return {
    id: session.id,

    /**
     * @param {string} fullText
     * @param {string} [summary]
     */
    recordRead(fullText, summary = '') {
      const text = String(fullText || '').trim();
      if (!text) return;
      n += 1;
      session.reads.push({
        n,
        fullText: text,
        summary: String(summary || '').trim(),
        at: new Date().toISOString(),
      });
      while (session.reads.length > MAX_READS_PER_SESSION) session.reads.shift();
    },

    /** Persist this call so iMessage can recall it later. Safe to call more than once. */
    end() {
      if (session.endedAt) return session;
      session.endedAt = new Date().toISOString();
      if (!session.reads.length) return session;
      const store = loadStore();
      const idx = store.sessions.findIndex(s => s.id === session.id);
      if (idx >= 0) store.sessions[idx] = session;
      else store.sessions.push(session);
      saveStore(store);
      return session;
    },
  };
}

/**
 * Score a saved read against an iMessage / recall question.
 * @param {string} question
 * @param {SessionRead} read
 */
function scoreRead(question, read) {
  const ask = String(question || '').toLowerCase();
  const hay = `${read.summary || ''} ${read.fullText || ''}`.toLowerCase();
  if (!hay.trim()) return 0;
  const words = ask
    .split(/[^a-z0-9]+/)
    .filter(
      w =>
        w.length > 2 &&
        !['the', 'and', 'for', 'that', 'this', 'what', 'was', 'from', 'have', 'much', 'many', 'about', 'argo', 'please', 'tell', 'text'].includes(
          w,
        ),
    );
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 2;
  if (/ingredient/.test(ask) && /ingredient/.test(hay)) score += 5;
  if (/sodium|salt/.test(ask) && /sodium|salt/.test(hay)) score += 5;
  if (/caffeine/.test(ask) && /caffeine/.test(hay)) score += 5;
  if (/calor/.test(ask) && /calor/.test(hay)) score += 4;
  if (/poem|verse/.test(ask) && !/nutrition|calories|sodium|ingredient/.test(hay)) score += 3;
  return score;
}

/**
 * Build a memory blob from past FaceTime sessions for iMessage Q&A.
 * Never used by the live FaceTime agent (that stays per-call only).
 * @param {string} question
 * @param {{ maxReads?: number }} [opts]
 * @returns {{ text: string, sessionCount: number, readCount: number }}
 */
export function searchPastSessions(question, opts = {}) {
  const maxReads = opts.maxReads ?? 6;
  const store = loadStore();
  /** @type {{ score: number, read: SessionRead, sessionId: string, startedAt: string }[]} */
  const scored = [];
  for (const session of store.sessions) {
    for (const read of session.reads || []) {
      scored.push({
        score: scoreRead(question, read),
        read,
        sessionId: session.id,
        startedAt: session.startedAt,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || String(b.startedAt).localeCompare(String(a.startedAt)));
  const picked =
    scored[0]?.score > 0
      ? scored.filter(s => s.score > 0).slice(0, maxReads)
      : scored.slice(0, Math.min(3, maxReads));

  const text = picked
    .map(
      (p, i) =>
        `Session ${p.startedAt.slice(0, 16)} read ${i + 1}: ${p.read.summary || '(no summary)'}\n${p.read.fullText}`,
    )
    .join('\n\n')
    .trim();

  return {
    text,
    sessionCount: new Set(picked.map(p => p.sessionId)).size,
    readCount: picked.length,
  };
}

export function sessionStorePath() {
  return STORE_PATH;
}
