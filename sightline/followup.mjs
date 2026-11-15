/**
 * Argo only takes a new camera snapshot when the caller asks him to look at something
 * ("read this", "describe my screen", "what's in my camera", "tell me what you see", "look again"…).
 * Every other turn is answered from the pictures already taken (if any) or as normal conversation,
 * so Argo never silently re-scans the camera.
 */

// Requests to look at / read / describe something with the camera. Kept broad on purpose:
// asking in your own words ("describe my screen") must work, not just "read this".
const EXPLICIT_LOOK = new RegExp(
  [
    // "describe …" in any form, plus read/scan/check/identify + an object
    String.raw`\bdescribe\b`,
    String.raw`\b(read|scan|check|identify)\s+(this|that|it|these|those|my|the|what|again|out|for me|aloud|out loud)\b`,
    // "look at this / my screen / the label", "look again", "have a look"
    String.raw`\b(look|looking)\s+(at|again|here|over here)\b`,
    String.raw`\b(take|have)\s+(a|another|one more)\s+(look|picture|photo|pic|snapshot|peek)\b`,
    // "what is this", "what's on my screen", "what's in my camera / hand / front of me"
    String.raw`\bwhat\s*(['’]?s|is|are)\s+(this|that|these|those|it)\b`,
    String.raw`\bwhat\s*(['’]?s|is|are)\s+(on|in)\s+(my|the|this|that|front)\b`,
    String.raw`\bwhat(\s+does|['’]?s)\s+(this|that|it)\s+say\b`,
    String.raw`\bwhat\s+(do|can)\s+you\s+see\b`,
    String.raw`\btell\s+me\s+what\s+(you\s+see|this\s+is|it\s+says|that\s+is|is\s+(on|in))\b`,
    String.raw`\bwhat\s+am\s+i\s+(holding|looking at|showing|pointing at)\b`,
    String.raw`\bcan\s+you\s+(read|see|look|scan|describe|tell)\b`,
    String.raw`\b(see|show)\s+(this|my|the)\s+(screen|camera|picture|label|menu|sign|page)\b`,
    String.raw`\b(new|another|different)\s+(label|menu|one|page|item|picture|thing)\b`,
    String.raw`\btry\s+again\b`,
    String.raw`\bone\s+more\s+time\b`,
  ].join('|'),
  'i',
);

/**
 * True only when the caller asks Argo to look at / read / describe something new.
 * @param {string} userBits
 */
export function wantsFreshLook(userBits) {
  const u = String(userBits || '').trim();
  if (!u) return false;
  return EXPLICIT_LOOK.test(u);
}
