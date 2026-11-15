import { llm, Task } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoStream } from '@livekit/rtc-node';

/**
 * Keep the latest FaceTime caller frame and describe it with Gemini.
 * Menu/label reading needs a strong vision model + enough output tokens.
 * gemini-2.5-flash "thinks" inside the output budget — a low maxOutputTokens
 * was truncating answers to "I" / "I see a".
 */

const VISION_PROMPT = `You are the eyes for Argo, a FaceTime helper for people with low vision.

Look at this camera frame carefully. The caller may show a menu, medicine label, mail, product box, appliance dial, sign, or everyday object.

If there is readable text (menu, label, letter, sign, packaging):
- Start with what it is in a few words (for example: coffee menu, pill bottle, letter).
- Then give the most useful facts in short separate sentences (item and price; medicine name and dose; who a letter is from; dial setting).
- Prefer real words from the image. Skip decoration and blurry lines.
- Keep the whole answer to about 2 to 5 short sentences the caller can hear out loud.

If it is an object with little or no text, say what it is and where it is in one short sentence.

If the image is blurry, dark, cut off, or unreadable, say you cannot read it yet and ask them to hold steady and move closer.

No markdown. No bullet lists. No medical advice — only read what is printed.`;

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
  const serialized = await llm.serializeImage(
    llm.createImageContent({
      image: frame,
      inferenceDetail: 'high',
      inferenceWidth: 1280,
      inferenceHeight: 1280,
    }),
  );
  if (!serialized.base64Data) {
    throw new Error('Could not encode caller video frame to JPEG');
  }
  return {
    mimeType: serialized.mimeType || 'image/jpeg',
    base64: serialized.base64Data,
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

  const { mimeType, base64 } = await frameToJpegBase64(frame);
  // Paid-tier sweet spot: strong OCR/vision. Override with GEMINI_VISION_MODEL.
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
    maxOutputTokens: 512,
    // Critical for 2.5/3.x Flash: disable internal thinking so OCR text is not truncated.
    thinkingConfig: { thinkingBudget: 0 },
  };

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
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.json().catch(() => ({}));
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

  if (!text) {
    const finish = body?.candidates?.[0]?.finishReason;
    console.warn('[argo] empty vision text', { finish, model });
    return 'I cannot read that clearly yet. Hold the menu steady and a bit closer, then ask me again.';
  }

  // Keep enough for a short menu read-aloud (was 280 and often cut mid-item).
  return text.replace(/\s+/g, ' ').slice(0, 600);
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
