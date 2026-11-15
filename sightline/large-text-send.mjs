/**
 * On-demand iMessage large-text: no auto-PNG after every OCR.
 * Buffers what Argo read this call; sends one digest when the caller asks.
 */

/**
 * Normalize for near-duplicate checks.
 * @param {string} text
 */
export function normalizeReadText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.$%]/g, '')
    .trim();
}

/**
 * True when the caller wants the large-text PNG on iMessage (not a fresh camera read).
 * "Send me this" still means look at the camera; "send me the ingredients" / "text me that" means PNG.
 * @param {string} userBits
 */
export function wantsLargeTextSend(userBits) {
  const u = String(userBits || '').trim();
  if (!u) return false;

  // Explicit Messages / handout channel.
  if (
    /imessage\b|i message\b|in (a |my )?messages?\b|to my (phone|messages?)\b|large text|big text|handout\b/i.test(
      u,
    )
  ) {
    return true;
  }

  // "text me …" almost always means iMessage (including "text me the ingredients").
  if (/\btext me\b/i.test(u)) return true;

  // "send me a list of ingredients", "send me the nutrition", etc.
  if (
    /\bsend me\b.{0,60}\b(list|ingredients?|nutrition|directions?|allergens?|warnings?|dosage|dose|side effects|what you (just )?read|everything you read)\b/i.test(
      u,
    )
  ) {
    return true;
  }

  if (
    /send (me )?(the )?(png|image|picture)\b/i.test(u) ||
    /send (me )?(what you (just )?read|everything you read|all (of )?(that|this)|the digest)\b/i.test(
      u,
    )
  ) {
    return true;
  }

  // "send that/it" without camera verbs — handout of memory, not a new look.
  if (/\bsend (me )?(that|it)\b/i.test(u) && !/\b(read|look|see|camera|this|label|menu)\b/i.test(u)) {
    return true;
  }

  return false;
}

/**
 * Session buffer of OCR results for one FaceTime call.
 * @param {{ maxEntries?: number, maxChars?: number }} [opts]
 */
export function createReadDigest(opts = {}) {
  const maxEntries = opts.maxEntries ?? 8;
  const maxChars = opts.maxChars ?? 3500;
  /** @type {string[]} */
  const entries = [];
  let lastSentNorm = '';

  return {
    /**
     * @param {string} text
     */
    append(text) {
      const t = String(text || '').trim();
      if (!t) return;
      const norm = normalizeReadText(t);
      const prev = entries[entries.length - 1];
      if (prev && normalizeReadText(prev) === norm) return;
      // Drop near-duplicates of any recent entry (same label re-read).
      if (entries.some(e => normalizeReadText(e) === norm)) return;
      entries.push(t);
      while (entries.length > maxEntries) entries.shift();
    },

    /** @returns {string} */
    latest() {
      return entries[entries.length - 1] || '';
    },

    /** @returns {string} */
    digest() {
      if (!entries.length) return '';
      let out = entries.join('\n\n');
      if (out.length > maxChars) {
        out = out.slice(out.length - maxChars);
        const cut = out.indexOf('\n');
        if (cut > 0 && cut < 80) out = out.slice(cut + 1);
      }
      return out.trim();
    },

    /** @returns {number} */
    count() {
      return entries.length;
    },

    /**
     * @param {string} text
     * @returns {boolean}
     */
    alreadySent(text) {
      const n = normalizeReadText(text);
      return Boolean(n) && n === lastSentNorm;
    },

    /**
     * @param {string} text
     */
    markSent(text) {
      lastSentNorm = normalizeReadText(text);
    },

    clear() {
      entries.length = 0;
      lastSentNorm = '';
    },
  };
}
