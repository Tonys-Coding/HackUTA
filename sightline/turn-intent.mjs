/**
 * Classify FaceTime caller utterances into safe, low-vision-friendly intents.
 * Prefer explicit handlers over dumping everything into the LLM follow-up path.
 */
import { wantsFreshLook } from './followup.mjs';
import { parseThemeRequest, wantsReadWithTheme } from './theme-pref.mjs';

/**
 * @typedef {'ack' | 'stop' | 'help' | 'zoom' | 'resend' | 'theme_list' | 'theme_sample' | 'theme_ocr' | 'ocr' | 'follow_up' | 'noop'} TurnIntent
 */

/** Fact questions about what's already in frame — OCR when we have no prior read yet. */
function wantsLabelFacts(u) {
  return /\b(?:how much|how many|calories?|sodium|caffeine|sugar|protein|carb|carbohydrate|dose|expir|ingredient|nutrition|serving|price|cost|total|what about)\b/.test(
    u,
  );
}

/** Half-spoken fragments should not become fake Q&A. */
function isIncompleteUtterance(u) {
  if (/[-—…]$/.test(u.trim())) return true;
  if (/\b(?:you can just|hold on|one sec|wait a|i was gonna|i'm just gonna)\b/.test(u) && !/\?$/.test(u)) {
    return u.split(/\s+/).length <= 10;
  }
  return false;
}

/**
 * If they ask for a nutrient that was never captured in the last OCR, look again.
 * @param {string} question
 * @param {string} memory
 */
export function memoryMissingRequestedFact(question, memory) {
  const q = String(question || '').toLowerCase();
  const m = String(memory || '').toLowerCase();
  /** @type {Array<[RegExp, RegExp]>} */
  const fields = [
    [/\bprotein\b/, /\bprotein\b/],
    [/\bcarb|\bcarbohydrate/, /\bcarb/],
    [/\bsodium|\bsalt\b/, /\bsodium|\bsalt\b/],
    [/\bsugar/, /\bsugar/],
    [/\bcaffeine\b/, /\bcaffeine\b/],
    [/\bfat\b/, /\bfat\b/],
    [/\bfiber|\bfibre/, /\bfiber|\bfibre/],
    [/\bcalories?\b/, /\bcalor/],
  ];
  for (const [ask, have] of fields) {
    if (ask.test(q) && !have.test(m)) return true;
  }
  return false;
}

/**
 * @param {string} userBits
 * @param {string} lastRead
 * @returns {{
 *   intent: TurnIntent,
 *   theme?: string,
 *   spoken?: string,
 * }}
 */
export function classifyTurn(userBits, lastRead) {
  const raw = String(userBits || '').trim();
  const u = raw.toLowerCase();
  const hasMemory = Boolean(String(lastRead || '').trim());

  if (!u) return { intent: 'noop' };

  if (isIncompleteUtterance(u)) return { intent: 'noop' };

  // Backchannels / politeness — never trigger OCR or invent answers.
  if (
    /^(okay|ok|k|alright|all right|thanks|thank you|thank you argo|got it|cool|great|perfect|yeah|yep|yes|mm+hm+|uh huh|sure)\.?\!?$/i.test(
      u,
    ) ||
    /^(thanks|thank you)[,.]?\s+(argo)?\.?$/i.test(u)
  ) {
    return { intent: 'ack' };
  }

  if (/\b(?:stop|quiet|shut up|be quiet|never ?mind|cancel|enough)\b/.test(u) && u.split(/\s+/).length <= 5) {
    return { intent: 'stop' };
  }

  // Explicit help only — do not catch "how many calories".
  if (
    /\b(?:what can you do|how do (?:i|you) use|commands?|options)\b/.test(u) ||
    /^(help|what now|how does this work)\??$/.test(u)
  ) {
    return { intent: 'help' };
  }

  // Pinch-zoom guidance for the iMessage PNG (not a camera action).
  if (/\b(?:zoom|bigger|larger|enlarge|magnif|too small|hard to read|make (?:it |the text )?bigger)\b/.test(u)) {
    return { intent: 'zoom' };
  }

  // Re-send last large-text PNG without a new camera look.
  // "send this/that/it" = resend; "read this and send" is handled via theme_ocr / ocr.
  if (
    /\b(?:send|text|message|resend)\b/.test(u) &&
    /\b(?:it|that|this|again|me|the (?:text|image|picture|png|menu|label))\b/.test(u) &&
    !/\b(?:read|look|see|camera|using|contrast|yellow|cream|dark|white|theme)\b/.test(u)
  ) {
    return { intent: hasMemory ? 'resend' : 'help' };
  }
  if (/^(send it|text (?:it|me|that)|send again|text again|resend)\.?$/i.test(u)) {
    return { intent: hasMemory ? 'resend' : 'help' };
  }

  const themeReq = parseThemeRequest(raw);
  if (themeReq?.kind === 'list') return { intent: 'theme_list' };
  if (themeReq?.kind === 'set') {
    if (wantsReadWithTheme(raw)) {
      return { intent: 'theme_ocr', theme: themeReq.theme, spoken: themeReq.spoken };
    }
    return { intent: 'theme_sample', theme: themeReq.theme, spoken: themeReq.spoken };
  }

  // "Read the ingredients" must OCR even if "ingredient" looks like a follow-up keyword.
  if (/\b(?:read|look at|see)\b.+\b(?:ingredient|label|text|menu|sign|box|bottle|can)\b/.test(u)) {
    return { intent: 'ocr' };
  }

  if (!hasMemory) {
    // Camera already on a label + "how many calories" → read it (do not re-prompt).
    if (wantsFreshLook(raw, '') || wantsLabelFacts(u)) return { intent: 'ocr' };
    return { intent: 'noop' };
  }

  if (wantsFreshLook(raw, lastRead)) return { intent: 'ocr' };
  // Follow-up for a nutrient we never stored → look at the camera again.
  if (memoryMissingRequestedFact(raw, lastRead)) return { intent: 'ocr' };
  return { intent: 'follow_up' };
}

export const HELP_SPOKEN =
  'Show the label to the camera and ask how many calories, or say read this. After that, ask follow-ups. Say cream, yellow, white, or dark for the text image.';

export const ZOOM_SPOKEN =
  'Open the image I texted you, then pinch to zoom. I can also resend it if you say send it.';

export const ACK_SPOKEN = 'Okay.';
export const STOP_SPOKEN = 'Okay. I am listening.';
export const RESEND_SPOKEN = 'Sending that large text again now.';
export const NO_MEMORY_SPOKEN =
  'I have not read anything yet. Hold the label in the camera and ask again.';
