import { Task } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

/**
 * Keep the latest FaceTime caller frame and describe it with Gemini.
 * Menu/label reading needs a strong vision model + enough output tokens.
 * gemini-2.5-flash "thinks" inside the output budget — a low maxOutputTokens
 * was truncating answers to "I" / "I see a".
 */

const VISION_PROMPT = `Eyes for Argo (low-vision FaceTime helper). Read this camera frame fast.

If there is readable text (menu, label, can, letter, sign, packaging):
- Name what it is in a few words, then the useful facts in short sentences (brand, product, dose, price, who from).
- Prefer real words from the image. Skip blur and decoration.
- Keep the whole answer to 2–4 short spoken sentences.

If little text: say what the object is in one short sentence.
If unreadable: say you cannot read it yet and ask them to hold steady and closer.
No markdown, lists, or medical advice.`;

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
 * Ask Gemini what is in the frame. Returns short speakable text.
 * @param {import('@livekit/rtc-node').VideoFrame} frame
 * @param {string} [extraHint]
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
    // Smaller budget = faster first token / shorter labels (menus still fit).
    maxOutputTokens: Number(process.env.VISION_MAX_OUTPUT_TOKENS) || 256,
    // Critical for 2.5/3.x Flash: disable internal thinking so OCR text is not truncated.
    thinkingConfig: { thinkingBudget: 0 },
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

  if (!text) {
    const finish = body?.candidates?.[0]?.finishReason;
    console.warn('[argo] empty vision text', { finish, model });
    return 'I cannot read that clearly yet. Hold the menu steady and a bit closer, then ask me again.';
  }

  // Keep enough for a short menu read-aloud (was 280 and often cut mid-item).
  return text.replace(/\s+/g, ' ').slice(0, 480);
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
