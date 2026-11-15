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

// A real question or task (not just "hello" / "okay").
const QUESTION_LIKE =
  /\?|\b(how|what|which|who|where|when|why|is there|are there|is it|is this|are these|does|do i|do you|can i|should i|tell me|calculate|add up|total|calories|sodium|sugar|fat|protein|carbs?|price|cost|ingredients?|expire|expiration|dose|color|colour|brand|size|serving)\b/i;
// Small talk that should never trigger a picture.
const SMALL_TALK =
  /^\s*(hi|hello|hey|yo|okay|ok|yes|yeah|yep|no|nope|thanks|thank you|cool|great|nice|bye|goodbye|hang up|stop|wait|hmm|um|uh|mm-hmm|sure|alright|got it|are you (there|good|ok|okay|ready)|how are you|can you hear me|who are you|what('s| is) your name)\b[^?]{0,20}\??\s*$/i;
// The question points at what the camera shows right now ("in this", "these", "what I'm holding").
const POINTS_AT_CURRENT_VIEW =
  /\b(this|these|here|in front of me|i'?m holding|i am holding|my hand|right now)\b/i;
// Asking to hear what was already captured ("read the poem", "read it again", "repeat that"),
// often said after lowering the phone. With pictures saved this must NOT take a new (black) picture.
const READS_SAVED =
  /\b(read|repeat|say|describe)\s+(it|that|them|back|everything|all|the\s+(poem|text|label|menu|letter|sign|page|words|rest|whole|first|second|third|last|recipe|note|list))\b|\bread\s+(it\s+)?(again|out|aloud|out loud)\b|\bwhat\s+did\s+(it|that)\s+say\b/i;
// Signals the caller is showing something new to the camera.
const NEW_THING = /\b(this|these|new|another|different|next|now)\b|\blook\b/i;
// The caller is clearly asking about an earlier picture, so do not take a new one.
const REFERS_TO_EARLIER =
  /\b(first|second|third|previous|earlier|before|last one|other one|that one|the one before|go back)\b/i;

// Kinds of things a caller names ("read the nutrition label"). If the named kind is not in any saved
// picture, it is something new to look at, not a re-read of what is saved.
const KIND_NOUNS =
  /\b(nutrition|label|labels|menu|receipt|sign|letter|mail|envelope|page|poem|recipe|note|list|card|box|bottle|can|jar|book|ticket|bill|form|document|screen|ingredients|instructions|medicine|pill|prescription|package|packet|bag|pouch|map|calendar|schedule|price|tag|book)\b/gi;

/**
 * True when the caller names a kind of item ("the nutrition label") that none of the saved pictures
 * contain, so "read the nutrition label" after a poem takes a new picture instead of re-reading the poem.
 * @param {string} userBits
 * @param {string} savedText lower-cased summaries + text of the saved pictures
 */
export function namesUnsavedThing(userBits, savedText) {
  const named = namedKinds(userBits);
  if (!named.length) return false;
  const saved = String(savedText || '').toLowerCase();
  return named.some(w => !saved.includes(w));
}

/** Kinds of items named in the request ("nutrition", "label", "poem"…), singular. */
function namedKinds(userBits) {
  return (String(userBits || '').toLowerCase().match(KIND_NOUNS) || []).map(w => w.replace(/s$/, ''));
}

/** True when the caller names item kinds and every one of them is in a saved picture. */
function namesOnlySavedThings(userBits, savedText) {
  const named = namedKinds(userBits);
  if (!named.length) return false;
  const saved = String(savedText || '').toLowerCase();
  return named.every(w => saved.includes(w));
}

// Short "stop talking" commands that may cut Argo off even mid-readout.
const STOP_COMMAND =
  /^\s*(?:(?:hey\s+)?argos?|argo)?[\s,.!]*(stop|stop it|stop talking|stop reading|stop please|please stop|okay stop|ok stop|be quiet|quiet|cancel|hold on|wait|wait wait|pause|enough|shut up|that'?s enough)[\s,.!]*(?:argos?|argo|please)?[\s.!?]*$/i;

/**
 * True for a short spoken command to stop Argo talking ("stop", "Argos stop", "wait", "cancel"…).
 * Only short phrases count, so background sentences that merely contain "wait" do not stop him.
 * @param {string} transcript
 */
export function isStopCommand(transcript) {
  const t = String(transcript || '').trim();
  if (!t || t.split(/\s+/).length > 4) return false;
  return STOP_COMMAND.test(t) || /\bargos?\s*,?\s*stop\b/i.test(t);
}

/**
 * Is this speech meant for Argo (a question, a request about the pictures, or small talk to him)?
 * Background chatter ("yeah, cool, hydration's better") is not, and is ignored once pictures are
 * saved, so nearby voices don't make Argo answer (and re-read the poem) on his own.
 * @param {string} userBits
 */
export function isMeantForArgo(userBits) {
  const u = String(userBits || '').trim();
  if (!u) return false;
  return (
    EXPLICIT_LOOK.test(u) ||
    READS_SAVED.test(u) ||
    QUESTION_LIKE.test(u) ||
    REFERS_TO_EARLIER.test(u) ||
    SMALL_TALK.test(u) ||
    /\b(argo|argos|please|help|again|stop)\b/i.test(u)
  );
}

/**
 * Should Argo take a new snapshot for this turn?
 * - Explicit requests ("read this", "describe my screen", "look again"…) always do.
 * - With no saved picture yet, any real question does ("how many calories in three of these?"),
 *   so the caller never has to say a magic phrase first. Small talk does not.
 * - With saved pictures, a question about "this / these / what I'm holding" takes a new one
 *   (they are probably showing something new); other questions use the saved pictures.
 * @param {string} userBits
 * @param {boolean} [hasSavedPictures]
 */
export function wantsFreshLook(userBits, hasSavedPictures = false, savedText = '') {
  const u = String(userBits || '').trim();
  if (!u) return false;
  // Naming something that is not in the saved pictures ("read the nutrition label" after a poem)
  // means a new item: take a picture.
  if (hasSavedPictures && savedText && namesUnsavedThing(u, savedText)) return true;
  // Naming only things that ARE saved ("read the nutrition label" once the label is saved): memory.
  if (hasSavedPictures && savedText && namesOnlySavedThings(u, savedText) && !NEW_THING.test(u)) return false;
  // "Read the poem" / "read it again" after lowering the phone: read from the saved picture.
  if (hasSavedPictures && READS_SAVED.test(u) && !NEW_THING.test(u)) return false;
  if (EXPLICIT_LOOK.test(u)) return true;
  if (SMALL_TALK.test(u)) return false;
  if (!QUESTION_LIKE.test(u)) return false;
  if (!hasSavedPictures) return true;
  return POINTS_AT_CURRENT_VIEW.test(u) && !REFERS_TO_EARLIER.test(u);
}
