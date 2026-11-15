import { Task } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

/**
 * Keep the latest FaceTime caller frame and describe it with Gemini.
 * Menu/label reading needs a strong vision model + enough output tokens.
 * gemini-2.5-flash "thinks" inside the output budget — a low maxOutputTokens
 * was truncating answers to "I" / "I see a".
 */

const VISION_PROMPT = `Eyes for Argo (low-vision FaceTime helper). Read this camera frame fast.

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
- Menus: every item with its price. Medicine: name, dose, directions, warnings, expiry.
- Plain text. Separate facts with " | " (for example "Calories 160 | Sodium 230mg 10% | Protein 2g").
- Empty string if there is no readable text.`;

// Structured output so the spoken answer and the full transcription come back together.
const VISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    spoken: { type: 'STRING' },
    fullText: { type: 'STRING' },
  },
  required: ['spoken', 'fullText'],
  propertyOrdering: ['spoken', 'fullText'],
};

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
  // LiveKit serializeImage uses PNG (~1MB). Sharp JPEG at 640 is much faster to upload.
  const sharp = (await import('sharp')).default;
  const side = Number(process.env.VISION_JPEG_SIZE) || 640;
  const quality = Number(process.env.VISION_JPEG_QUALITY) || 70;
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
 * @returns {Promise<{ spoken: string, fullText: string }>}
 */
export async function describeFrame(frame, extraHint = '') {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key || /YOUR_/.test(key)) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const t0 = Date.now();
  const { mimeType, base64 } = await frameToJpegBase64(frame);
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
  if (!text) {
    console.warn('[argo] empty vision text', { finish, model });
    return {
      spoken: 'I cannot read that clearly yet. Hold the menu steady and a bit closer, then ask me again.',
      fullText: '',
    };
  }

  const { spoken, fullText } = parseVisionJson(text);
  console.info('[argo] vision memory', { spokenChars: spoken.length, fullTextChars: fullText.length, finish });
  return {
    // Keep enough for a short menu read-aloud (was 280 and often cut mid-item).
    spoken: spoken.replace(/\s+/g, ' ').slice(0, 480),
    // Memory for follow-ups: keep line breaks, cap size so the LLM prompt stays small.
    fullText: fullText.trim().slice(0, 4000),
  };
}

/**
 * Parse Gemini's JSON reply. If it is cut off or not JSON, fall back to treating the whole reply as
 * the spoken text (the old behaviour) so a read never fails outright.
 * @param {string} text
 */
function parseVisionJson(text) {
  try {
    const obj = JSON.parse(text);
    const spoken = String(obj?.spoken || '').trim();
    const fullText = String(obj?.fullText || '').trim();
    if (spoken) return { spoken, fullText: fullText || spoken };
  } catch {
    /* fall through */
  }
  // Truncated JSON (hit maxOutputTokens): salvage the "spoken" field if it finished.
  const m = text.match(/"spoken"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    const spoken = JSON.parse(`"${m[1]}"`);
    return { spoken, fullText: spoken };
  }
  return { spoken: text, fullText: text };
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
