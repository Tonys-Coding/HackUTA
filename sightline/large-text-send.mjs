/**
 * On-demand iMessage large-text: no auto-PNG after every OCR.
 * Buffers each read this call; sends the matching entry (or latest) when asked.
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

const SEND_KIND =
  /\b(list|ingredients?|nutrition|directions?|allergens?|warnings?|dosage|dose|side effects|poem|poems|verse|receipt|menu|label|letter|mail|note|notes|message|messages|support|page|pages|sign|recipe|card|bill|form|document|instructions?|medicine|prescription)\b/i;

/**
 * True when the caller wants every saved read in one PNG.
 * @param {string} userBits
 */
export function wantsFullDigest(userBits) {
  return /everything you read|all (of )?(that|this|them)|all (the )?reads|the (whole )?digest|send (me )?everything/i.test(
    String(userBits || ''),
  );
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

  // "text me …" almost always means iMessage (including "text me the poem").
  if (/\btext me\b/i.test(u)) return true;

  // "send me a list of ingredients", "send me the poem", "send me that support message", etc.
  if (/\bsend me\b.{0,80}/i.test(u) && SEND_KIND.test(u)) return true;

  if (
    /\bsend me\b.{0,60}\b(what you (just )?read|everything you read)\b/i.test(u) ||
    /send (me )?(the )?(png|image|picture)\b/i.test(u) ||
    /send (me )?(what you (just )?read|everything you read|all (of )?(that|this)|the digest)\b/i.test(
      u,
    )
  ) {
    return true;
  }

  // "send that/it" without camera verbs — handout of memory, not a new look.
  if (/\bsend (me )?(that|it)\b/i.test(u) && !/\b(read|look|see|camera|this)\b/i.test(u)) {
    return true;
  }

  return false;
}

/** Content words for matching a request to a saved read. */
function matchWords(text) {
  const stop = new Set([
    'the',
    'a',
    'an',
    'me',
    'my',
    'please',
    'send',
    'text',
    'large',
    'big',
    'that',
    'this',
    'it',
    'you',
    'just',
    'read',
    'what',
    'everything',
    'all',
    'list',
    'of',
    'to',
    'in',
    'messages',
    'message',
    'imessage',
    'png',
    'image',
    'picture',
    'handout',
  ]);
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9%]{2,}/g);
  if (!words) return [];
  return words.filter(w => !stop.has(w));
}

/**
 * @param {string} userBits
 * @param {{ text: string, summary: string }} entry
 */
export function scoreHandoutMatch(userBits, entry) {
  const hay = normalizeReadText(`${entry.summary || ''} ${entry.text || ''}`);
  if (!hay) return 0;
  const words = matchWords(userBits);
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += 2;
  }
  // Kind hints when the OCR never contains the word itself (e.g. a poem body).
  if (/\bpoem|verse\b/i.test(userBits) && !/\b(nutrition|calorie|sodium|ingredient)\b/i.test(hay)) {
    if (/\bpoem|verse|stanza|langston|frost|hughes\b/i.test(hay) || (entry.summary || '').length > 0) {
      // Prefer non-label entries for "poem"
      if (!/\bnutrition|calories|sodium|ingredients?\b/i.test(hay)) score += 3;
    }
  }
  if (/\b(support|message|note|letter|mail)\b/i.test(userBits)) {
    if (/\b(support|message|dear|hello|hi |thanks|help|contact)\b/i.test(hay)) score += 3;
    if (/\b(nutrition|calories|sodium|ingredients?)\b/i.test(hay)) score -= 2;
  }
  if (/\b(ingredient|nutrition|label)\b/i.test(userBits)) {
    if (/\b(nutrition|calories|sodium|ingredients?)\b/i.test(hay)) score += 4;
  }
  return score;
}

/**
 * Session buffer of OCR results for one FaceTime call.
 * @param {{ maxEntries?: number, maxChars?: number }} [opts]
 */
export function createReadDigest(opts = {}) {
  const maxEntries = opts.maxEntries ?? 8;
  const maxChars = opts.maxChars ?? 3500;
  /** @type {{ text: string, summary: string }[]} */
  const entries = [];
  /** @type {Set<string>} */
  const sentNorms = new Set();

  return {
    /**
     * @param {string} text
     * @param {string} [summary] short spoken line — helps match "the poem" later
     */
    append(text, summary = '') {
      const t = String(text || '').trim();
      if (!t) return;
      const norm = normalizeReadText(t);
      if (entries.some(e => normalizeReadText(e.text) === norm)) return;
      entries.push({ text: t, summary: String(summary || '').trim() });
      while (entries.length > maxEntries) entries.shift();
    },

    /** @returns {string} */
    latest() {
      return entries[entries.length - 1]?.text || '';
    },

    /**
     * @returns {{ text: string, summary: string }[]}
     */
    entries() {
      return entries.slice();
    },

    /** @returns {string} */
    digest() {
      if (!entries.length) return '';
      let out = entries.map(e => e.text).join('\n\n');
      if (out.length > maxChars) {
        out = out.slice(out.length - maxChars);
        const cut = out.indexOf('\n');
        if (cut > 0 && cut < 80) out = out.slice(cut + 1);
      }
      return out.trim();
    },

    /**
     * Best saved read for this send request, or '' if nothing suitable.
     * Generic "text me that" → latest. "send everything" → full digest.
     * Topic requests ("the poem") → best scoring entry (must beat 0).
     * @param {string} userBits
     * @returns {string}
     */
    pickHandout(userBits) {
      if (!entries.length) return '';
      if (wantsFullDigest(userBits)) return this.digest();

      const generic =
        /text me that|send (me )?(that|it)|large text|big text|what you (just )?read|handout\b/i.test(
          String(userBits || ''),
        ) && !SEND_KIND.test(String(userBits || ''));

      if (generic) {
        // Prefer latest not-yet-sent entry so a second "text me that" ships the new read.
        for (let i = entries.length - 1; i >= 0; i--) {
          const t = entries[i].text;
          if (!sentNorms.has(normalizeReadText(t))) return t;
        }
        return entries[entries.length - 1].text;
      }

      let best = null;
      let bestScore = 0;
      for (const entry of entries) {
        const score = scoreHandoutMatch(userBits, entry);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
      if (best && bestScore > 0) return best.text;

      // Poem/support often never contain those words — pick the non-label / non-menu entry.
      if (/\b(poem|verse)\b/i.test(String(userBits || ''))) {
        const nonLabel = [...entries]
          .reverse()
          .find(e => !/\bnutrition|calories|sodium|ingredients?|serving size\b/i.test(e.text));
        if (nonLabel) return nonLabel.text;
      }
      if (/\b(support|message|note|letter|mail)\b/i.test(String(userBits || ''))) {
        const nonLabel = [...entries]
          .reverse()
          .find(e => !/\bnutrition|calories|sodium|ingredients?|serving size\b/i.test(e.text));
        if (nonLabel) return nonLabel.text;
      }

      // Named a kind but nothing suitable — do not ship the wrong PNG.
      if (SEND_KIND.test(String(userBits || ''))) return '';

      return entries[entries.length - 1].text;
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
      return Boolean(n) && sentNorms.has(n);
    },

    /**
     * @param {string} text
     */
    markSent(text) {
      const n = normalizeReadText(text);
      if (n) sentNorms.add(n);
      // Mark each digest chunk if a combined send was used.
      for (const part of String(text || '').split(/\n\n+/)) {
        const pn = normalizeReadText(part);
        if (pn) sentNorms.add(pn);
      }
    },

    clear() {
      entries.length = 0;
      sentNorms.clear();
    },
  };
}


/** Content words for matching send requests (used by agent handoutFits fallbacks). */
const CONTENT_STOP = new Set([
  'the','a','an','is','are','was','were','what','whats','about','how','much','many','any',
  'does','did','do','it','its','me','my','you','your','can','could','would','should','tell',
  'please','of','for','to','and','or','on','in','at','have','has','with','this','that','those',
  'these','list','send','text','read','see','look','there','here','just','also','from','into',
]);

export function contentWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z][a-z0-9%]{2,}/g);
  if (!words) return [];
  return words.filter(w => !CONTENT_STOP.has(w));
}

export function contentFitsLastRead(userBits, lastReadText) {
  const last = String(lastReadText || '').toLowerCase();
  if (!last.trim()) return false;
  const words = contentWords(userBits);
  if (!words.length) return true;
  return words.some(w => last.includes(w));
}
