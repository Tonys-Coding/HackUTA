/**
 * Quick turn router: follow up on the last OCR vs take a fresh camera look.
 *
 * Rules of thumb:
 * - If we have memory and the caller is asking about / interpreting that thing → follow_up
 * - If they clearly point at a new document or ask to read again → fresh
 * - Default with memory → follow_up (don't re-dump the label on every question)
 */

const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'what',
  'whats',
  'about',
  'how',
  'much',
  'many',
  'any',
  'does',
  'did',
  'do',
  'it',
  'its',
  'me',
  'my',
  'you',
  'your',
  'can',
  'could',
  'would',
  'should',
  'tell',
  'please',
  'of',
  'for',
  'to',
  'and',
  'or',
  'on',
  'in',
  'at',
  'have',
  'has',
  'with',
  'this',
  'that',
  'those',
  'these',
  'list',
  'send',
  'text',
  'read',
  'see',
  'look',
  'there',
  'here',
  'just',
  'also',
  'from',
  'into',
  'than',
  'then',
  'them',
  'they',
  'will',
  'be',
  'think',
  'thought',
  'guess',
  'item',
  'food',
  'product',
  'thing',
  'stuff',
  'kind',
  'type',
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function contentWords(text) {
  const words = String(text || '')
    .toLowerCase()
    .match(/[a-z][a-z0-9%]{2,}/g);
  if (!words) return [];
  return words.filter(w => !STOP.has(w));
}

/**
 * @param {string} userBits
 * @param {string} lastReadText
 */
export function contentFitsLastRead(userBits, lastReadText) {
  const last = String(lastReadText || '').toLowerCase();
  if (!last.trim()) return false;
  const words = contentWords(userBits);
  if (!words.length) return true;
  return words.some(w => last.includes(w));
}

/** Asking about / interpreting the thing we already read. */
function aboutCurrentContext(u) {
  return (
    /\bwhat (is|are|was) (this|that|it)\b/i.test(u) ||
    /\bwhat('s|s) (this|that|it)\b/i.test(u) ||
    /\bwhat (food|item|product|dish|medicine|medication|drink)\b/i.test(u) ||
    /\bwhat do you (think|make of|reckon)\b/i.test(u) ||
    /\b(identify|infer|guess|summarize|summary)\b/i.test(u) ||
    /\bbased on (that|this|those|the)\b/i.test(u) ||
    /\bfrom (the |those |that )?(ingredients|label|text|list)\b/i.test(u) ||
    /\bso what is it\b/i.test(u) ||
    /\bkind of (food|product|thing)\b/i.test(u) ||
    /\bexplain (that|this|it)\b/i.test(u)
  );
}

/** Classic attribute / detail questions on the current label/menu. */
function looksLikeDetailFollowUp(u) {
  return /how much|price|cost|total|any |vegetarian|vegan|peanut|allergen|gluten|under |cheapest|expensive|iced|latte|dose|expir|ingredient|what about|does it|is there|who made|where (is|from)|address|sodium|calories|serving|how many|contains|made of/i.test(
    u,
  );
}

/** Absent-attribute probes still about the current item ("any peanuts?"). */
function absentAttributeProbe(u) {
  return /\b(any |is there|does it (have|contain)|allergen|peanut|gluten|vegan|vegetarian|nut[s]?\b)/i.test(
    u,
  );
}

/** Caller is switching to a different page/document in front of the camera. */
function looksLikeDocumentSwitch(u) {
  return /new (menu|one|label|page|slide|document|poster|thing|sheet)|something else|different (one|page|label|menu|document|sheet)|now (look|read)|next (one|page|slide)|switch|other (one|page)|bullet points?|judging|rubric|criteria|hackathon|whiteboard|this (page|slide|poster|document|rubric|sheet|printout)/i.test(
    u,
  );
}

/** Explicit request to look at the camera again (not "what is this?"). */
function looksLikeExplicitReread(u) {
  return (
    /look again|read again|hold (it |the )?(closer|steady)|try again|another look|take a look|look at (this|that)|read (this|it|that)|what (do you|can you) see|what('s| is) on (the |this )?(screen|page|label|menu|camera)|point (the )?camera/i.test(
      u,
    ) && !aboutCurrentContext(u)
  );
}

/**
 * Distinct topic words in the question that never appear in last OCR → new context.
 * @param {string} userBits
 * @param {string} lastReadText
 */
function foreignTopic(userBits, lastReadText) {
  const last = String(lastReadText || '').toLowerCase();
  const words = contentWords(userBits);
  if (!words.length) return false;
  // Need at least one distinctive word, and none of them in memory.
  return words.every(w => !last.includes(w));
}

/**
 * @param {string} userBits
 * @param {string} lastReadText
 * @returns {'fresh' | 'follow_up'}
 */
export function routeTurn(userBits, lastReadText) {
  if (!String(lastReadText || '').trim()) return 'fresh';
  const u = String(userBits || '').trim();
  if (!u) return 'fresh';

  // New document in front of the camera.
  if (looksLikeDocumentSwitch(u)) return 'fresh';
  if (looksLikeExplicitReread(u)) return 'fresh';

  // Interpret / ask about what we already read — stay in memory.
  if (aboutCurrentContext(u)) return 'follow_up';

  if (looksLikeDetailFollowUp(u)) {
    if (contentFitsLastRead(u, lastReadText) || absentAttributeProbe(u)) return 'follow_up';
    // e.g. "what about judging?" while memory is a food label
    if (foreignTopic(u, lastReadText)) return 'fresh';
    return 'follow_up';
  }

  // Clear "read/look" toward a new artifact name not in memory.
  if (/\b(read|look|see)\b/i.test(u) && foreignTopic(u, lastReadText)) return 'fresh';

  // Default with memory: answer from context (don't re-state the whole label).
  return 'follow_up';
}

/**
 * @param {string} userBits
 * @param {string} lastReadText
 */
export function wantsFreshLook(userBits, lastReadText) {
  return routeTurn(userBits, lastReadText) === 'fresh';
}
