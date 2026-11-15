import { Task } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

/**
 * Keep the latest FaceTime caller frame and describe it with Gemini.
 * Menu/label reading needs a strong vision model + enough output tokens.
 * gemini-2.5-flash "thinks" inside the output budget — a low maxOutputTokens
 * was truncating answers to "I" / "I see a".
 */

const VISION_PROMPT = `Eyes for Argo (low-vision FaceTime helper). Read this camera frame fast.
Write "spoken" in English, even if the caller asked in another language; translate non-English text.

IGNORE these, they are not what the caller is showing you: a small inset / picture-in-picture window
showing a cartoon dog in a helmet and cape (that is you, Argo, on the call), and any video-call
interface (buttons, caller name, time, call controls). Never mention them. Describe only the
object, text or scene the caller is pointing the camera at.

Return JSON with two fields:

"spoken" — what Argo says out loud right now:
- If there is readable text (menu, label, can, letter, sign, packaging): name what it is in a few
  words, then the useful facts in short sentences (brand, product, dose, price, who from). If the
  caller asked a specific question, answer it directly (do any simple math they asked for).
- Prefer real words from the image. Skip blur and decoration.
- Keep it to 2–4 short spoken sentences. No markdown or lists. No medical advice.
- If little text: say what the object is in one short sentence.
- If unreadable: say you cannot read it yet and ask them to hold steady and closer.

"fullText" — Argo's memory of this frame, used later to answer follow-up questions without
looking again. Transcribe ALL readable text, not just what the caller asked about:
- Nutrition labels: every line with its amount and unit and % daily value (serving size, servings
  per container, calories, fats, cholesterol, sodium, carbs, fiber, sugars, protein, vitamins).
  Copy every digit exactly ("270mg", not "70mg"); read small print carefully. If the label has
  more than one column (per serving / per container / per pouch), say which column each number
  is from, e.g. "Sodium per serving 90mg 4% | Sodium per pouch 270mg 12%".
- Menus: every item with its price. Medicine: name, dose, directions, warnings, expiry.
- Plain text. Separate facts with " | " (for example "Calories 160 | Sodium 230mg 10% | Protein 2g").
- Empty string if there is no readable text.

"seen" — true if the picture clearly shows readable text OR an identifiable object/scene
(even with no text); false if it is too blurry, dark, or close to make out.`;

// Structured output so the spoken answer and the full transcription come back together.
const VISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    spoken: { type: 'STRING' },
    fullText: { type: 'STRING' },
    seen: { type: 'BOOLEAN' },
  },
  required: ['spoken', 'fullText', 'seen'],
  propertyOrdering: ['spoken', 'fullText', 'seen'],
};

const FOLLOW_UP_PROMPT = `You are Argo, a FaceTime helper for people with low vision. Below are the most
recent pictures the caller showed you during this call (up to three), oldest first, each labeled with
its number in the call. They have since lowered their phone, so answer from these pictures.
Always answer in English, even if the question is in another language or background voices are heard.
IGNORE these, they are not what the caller is showing you: a small inset / picture-in-picture window
showing a cartoon dog in a helmet and cape (that is you, Argo, on the call), and any video-call
interface (buttons, caller name, time, call controls). Never mention them. Describe only the
object, text or scene the caller is pointing the camera at.
- By default the question is about the MOST RECENT picture. Use an earlier one only if they refer to
  it ("the first one", "the previous one", "the other one", "the cereal box", "compare them"...).
- If they ask about a picture that is not below (for example an older one), say you only remember the
  last three pictures and they can show it again and ask about it.
Answer in one or two short spoken sentences. No markdown or lists. No medical advice.
Exception: if they ask you to read it ("read the poem", "read it start to finish", "read it again"),
read the full text word for word exactly once, from start to finish, with no summary, no
introduction and no repeating any part.
Do simple math if asked (for example, per-serving amount times number of servings).
Use exact numbers and words from the pictures.
They already showed you these pictures, so do not tell them to show you something unless they
clearly ask about an item that is not in any of the pictures (then say you cannot see that one,
and they can show it to the camera and ask about it). If the question is vague, cut off or
incomplete, answer about the most recent picture, or ask one short question to clarify.`;

/**
 * @param {import('@livekit/rtc-node').Room} room
 */
export function attachCallerVision(room) {
  /** @type {import('@livekit/rtc-node').VideoFrame | null} */
  let latestFrame = null;
  /** @type {VideoStream | null} */
  let videoStream = null;
  /** @type {Set<Task<void>>} */
  const tasks = new Set();
  let framesSeen = 0;

  const createVideoStream = track => {
    if (videoStream) {
      try {
        videoStream.cancel();
      } catch {
        /* already closed */
      }
      videoStream = null;
    }

    videoStream = new VideoStream(track);
    const stream = videoStream;
    const task = Task.from(async controller => {
      for await (const event of stream) {
        if (controller.signal.aborted) return;
        latestFrame = event.frame;
        framesSeen += 1;
      }
    });
    task.result.finally(() => tasks.delete(task));
    tasks.add(task);
  };

  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (pub.track?.kind === TrackKind.KIND_VIDEO) {
        createVideoStream(pub.track);
      }
    }
  }

  const onSubscribed = track => {
    if (track.kind === TrackKind.KIND_VIDEO) createVideoStream(track);
  };
  room.on(RoomEvent.TrackSubscribed, onSubscribed);

  return {
    get latestFrame() {
      return latestFrame;
    },
    get framesSeen() {
      return framesSeen;
    },
    takeFrame() {
      const frame = latestFrame;
      latestFrame = null;
      return frame;
    },
    peekFrame() {
      return latestFrame;
    },
    close() {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      if (videoStream) {
        try {
          videoStream.cancel();
        } catch {
          /* ignore */
        }
        videoStream = null;
      }
      for (const task of tasks) task.cancel();
      tasks.clear();
      latestFrame = null;
    },
  };
}

/**
 * Encode a LiveKit VideoFrame to base64 JPEG.
 * Keep resolution high enough that menu text stays readable.
 * @param {import('@livekit/rtc-node').VideoFrame} frame
 */
export async function frameToJpegBase64(frame) {
  // LiveKit serializeImage uses PNG (~1MB); JPEG is much faster to upload.
  // 640/q70 blurred small label print (read "270mg" as "70mg"); 1024/q85 keeps it legible.
  const sharp = (await import('sharp')).default;
  const side = Number(process.env.VISION_JPEG_SIZE) || 1024;
  const quality = Number(process.env.VISION_JPEG_QUALITY) || 85;
  const rgba =
    frame.type === VideoBufferType.RGBA ? frame : frame.convert(VideoBufferType.RGBA);
  const buf = await sharp(Buffer.from(rgba.data), {
    raw: { width: rgba.width, height: rgba.height, channels: 4 },
  })
    .resize(side, side, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return {
    mimeType: 'image/jpeg',
    base64: buf.toString('base64'),
  };
}

/**
 * Ask Gemini what is in the frame.
 * Returns `spoken` (short, read aloud now) and `fullText` (every readable line, kept as memory so
 * follow-ups like "what about sodium?" can be answered without a new look).
 * @param {import('@livekit/rtc-node').VideoFrame} frame
 * @param {string} [extraHint]
 * Also returns the snapshot itself (`image`) so follow-ups can be answered from the picture after the
 * caller lowers the phone, and `seen` (picture clearly showed text or an object).
 * @returns {Promise<{ spoken: string, fullText: string, seen: boolean, image: { mimeType: string, base64: string } }>}
 */
export async function describeFrame(frame, extraHint = '') {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || /YOUR_/.test(key)) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const t0 = Date.now();
  const { mimeType, base64 } = await frameToJpegBase64(frame);
  if (process.env.VISION_SAVE_SNAPSHOTS) void saveDebugSnapshot(base64);
  const encodeMs = Date.now() - t0;
  // Override with GEMINI_VISION_MODEL (e.g. gemini-2.5-flash) if 3.6 feels too slow.
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const wantsRead = /read|say|menu|what does|what's on|text|label|price/i.test(extraHint || '');
  const prompt = [
    VISION_PROMPT,
    extraHint ? `Caller said: ${extraHint}` : '',
    wantsRead
      ? 'The caller asked you to read. Prioritize reading visible text over describing the scene.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const generationConfig = {
    temperature: 0.1,
    // Room for the spoken answer plus a full label/menu transcription (256 truncated fullText).
    maxOutputTokens: Number(process.env.VISION_MAX_OUTPUT_TOKENS) || 1024,
    // Critical for 2.5/3.x Flash: disable internal thinking so OCR text is not truncated.
    thinkingConfig: { thinkingBudget: 0 },
    responseMimeType: 'application/json',
    responseSchema: VISION_SCHEMA,
  };

  const t1 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const body = await res.json().catch(() => ({}));
  const geminiMs = Date.now() - t1;
  if (!res.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`Gemini vision HTTP ${res.status}: ${detail}`);
  }

  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map(p => p.text)
    .filter(Boolean)
    .join(' ')
    .trim();

  console.info('[argo] vision timing', {
    model,
    encodeMs,
    geminiMs,
    totalMs: Date.now() - t0,
    jpegChars: base64.length,
  });

  const finish = body?.candidates?.[0]?.finishReason;
  const image = { mimeType, base64 };
  if (!text) {
    console.warn('[argo] empty vision text', { finish, model });
    return {
      spoken: 'I cannot read that clearly yet. Hold the menu steady and a bit closer, then ask me again.',
      fullText: '',
      seen: false,
      image,
    };
  }

  const { spoken, fullText, seen } = parseVisionJson(text);
  console.info('[argo] vision memory', {
    frame: `${frame.width}x${frame.height}`,
    seen,
    spokenChars: spoken.length,
    fullTextChars: fullText.length,
    finish,
  });
  // What Argo will answer follow-ups from (label/menu text only — handy when a number comes out wrong).
  console.info('[argo] vision fullText:', fullText.replace(/\s+/g, ' ').slice(0, 600));
  return {
    // Keep enough for a short menu read-aloud (was 280 and often cut mid-item).
    spoken: spoken.replace(/\s+/g, ' ').slice(0, 480),
    // Memory for follow-ups: keep line breaks, cap size so the LLM prompt stays small.
    fullText: fullText.trim().slice(0, 4000),
    seen,
    image,
  };
}

/**
 * Answer a follow-up question from the saved snapshots (the caller has lowered the phone).
 * Uses the pictures themselves, so questions about objects, colors or layout work, not just text,
 * and the caller can refer back to an earlier picture ("the first one", "compare them").
 * @param {Array<{ n: number, image: { mimeType: string, base64: string }, fullText: string, summary: string }>} pictures
 *   oldest first (at most the last three of the call)
 * @param {string} question
 * @param {number} [totalTaken] how many pictures were taken this call (so older ones can be named)
 * @returns {Promise<string>} short speakable answer
 */
export async function askAboutPictures(pictures, question, totalTaken = pictures.length) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || /YOUR_/.test(key)) throw new Error('Missing GEMINI_API_KEY');
  if (!pictures.length) throw new Error('no saved pictures');
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const parts = [
    {
      text:
        `${FOLLOW_UP_PROMPT}\n` +
        `${totalTaken} picture(s) were taken this call; you have the last ${pictures.length}.`,
    },
  ];
  pictures.forEach((p, i) => {
    const label = i === pictures.length - 1 ? `Picture ${p.n} (most recent)` : `Picture ${p.n}`;
    parts.push({
      text:
        `${label}. What you said about it: ${p.summary}` +
        (p.fullText ? `\nText transcribed from it (use to double-check numbers): ${p.fullText}` : ''),
    });
    parts.push({ inline_data: { mime_type: p.image.mimeType, data: p.image.base64 } });
  });
  parts.push({ text: `Caller asked: ${question}` });

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      // 1024 so a full poem/label read-aloud is not cut off (256 tokens ended mid-poem).
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`Gemini follow-up HTTP ${res.status}: ${detail}`);
  }
  const answer = (body?.candidates?.[0]?.content?.parts || [])
    .map(p => p.text)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.info('[argo] follow-up from saved picture', {
    model,
    pictures: pictures.length,
    ms: Date.now() - t0,
    answerChars: answer.length,
  });
  if (!answer) throw new Error('empty follow-up answer');
  // Long enough for a full read-aloud of a poem or label (480 cut poems off near the end).
  return answer.slice(0, 2000);
}

/**
 * Parse Gemini's JSON reply. If it is cut off or not JSON, fall back to treating the whole reply as
 * the spoken text (the old behaviour) so a read never fails outright.
 * `fullText` is only ever real text from the frame: empty means "nothing readable / unknown", so the
 * agent keeps no memory and the next question takes a fresh look (never "I cannot read…" as memory).
 * @param {string} text
 */
function parseVisionJson(text) {
  try {
    const obj = JSON.parse(text);
    const spoken = String(obj?.spoken || '').trim();
    const fullText = String(obj?.fullText || '').trim();
    // Older replies without "seen": treat readable text as seen.
    const seen = typeof obj?.seen === 'boolean' ? obj.seen || Boolean(fullText) : Boolean(fullText);
    if (spoken) return { spoken, fullText, seen };
  } catch {
    /* fall through */
  }
  // Truncated JSON (hit maxOutputTokens): salvage the "spoken" field if it finished.
  const m = text.match(/"spoken"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    const spoken = JSON.parse(`"${m[1]}"`);
    return { spoken, fullText: '', seen: false };
  }
  return { spoken: text, fullText: '', seen: false };
}

/**
 * Fire-and-forget event log to the local Express API (Mongo).
 * @param {Record<string, unknown>} event
 */
export async function logEvent(event) {
  const base = process.env.SIGHTLINE_API_URL || 'http://localhost:8787';
  try {
    await fetch(`${base}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* dashboard logging must never break a call */
  }
}

/**
 * Debug only (VISION_SAVE_SNAPSHOTS=1): write the exact JPEG sent to Gemini to
 * sightline/data/snapshots/ (gitignored) so you can see what Argo actually saw.
 * @param {string} base64
 */
async function saveDebugSnapshot(base64) {
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = new URL('./data/snapshots/', import.meta.url);
    await mkdir(dir, { recursive: true });
    const name = `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    await writeFile(new URL(name, dir), Buffer.from(base64, 'base64'));
    console.info('[argo] saved debug snapshot', name);
  } catch (error) {
    console.warn('[argo] could not save debug snapshot', error?.message || error);
  }
}
