/**
 * Argo only takes a new camera snapshot when the caller explicitly asks for one
 * ("read this", "look at this", "what does this say", "take a picture", "look again"…).
 * Every other turn is answered from the last thing read (if any) or as normal conversation,
 * so Argo never silently re-scans the camera.
 */

// Explicit requests to look at / read something with the camera.
const EXPLICIT_LOOK =
  /\b(read|scan|check|describe)\s+(this|that|it|these|those|the\s+\w+|again|out|for me|aloud|out loud)\b|\b(look|looking)\s+(at\s+(this|that|it|these|those|the\s+\w+)|again)\b|\btake\s+(a|another|one more)\s+(look|picture|photo|pic|snapshot)\b|\bwhat\s+(is|'s|are)\s+(this|that|these|those)\b|\bwhat(\s+does|'s)\s+(this|that|it)\s+say\b|\bwhat\s+(do|can)\s+you\s+see\b|\bcan\s+you\s+(read|see|look|scan)\b|\b(new|another|different)\s+(label|menu|one|page|item|picture)\b|\btry\s+again\b|\bone\s+more\s+time\b/i;

/**
 * True only when the caller explicitly asks Argo to look at / read something new.
 * @param {string} userBits
 */
export function wantsFreshLook(userBits) {
  const u = String(userBits || '').trim();
  if (!u) return false;
  return EXPLICIT_LOOK.test(u);
}
