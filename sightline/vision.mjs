import { llm, Task } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoStream } from '@livekit/rtc-node';

/**
 * Keep the latest FaceTime caller frame and describe it with Gemini.
 * Why separate from the voice session: Phase 1 needs a reliable "I see X"
 * path even before the caller finishes a spoken turn.
 */

const VISION_PROMPT = `You are the eyes for Argo, a FaceTime helper for low-vision callers.
Look at this camera frame. In ONE short spoken sentence, say what you clearly see.
If you can read text, read the most important words only.
If the image is blurry, dark, or empty, say you cannot see clearly yet and ask them to hold steady.
No markdown. No lists. Do not give medical advice.`;

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
    /** Take the current frame once (clears so the next turn gets a fresher one). */
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
 * Encode a LiveKit VideoFrame to base64 JPEG via LiveKit's serializer.
 * @param {import('@livekit/rtc-node').VideoFrame} frame
 */
export async function frameToJpegBase64(frame) {
  const serialized = await llm.serializeImage(
    llm.createImageContent({
      image: frame,
      inferenceDetail: 'high',
      inferenceWidth: 768,
      inferenceHeight: 768,
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
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const prompt = extraHint ? `${VISION_PROMPT}\nCaller said: ${extraHint}` : VISION_PROMPT;
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
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 120,
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`Gemini vision HTTP ${res.status}: ${detail}`);
  }

  const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join(' ').trim();
  if (!text) {
    return 'I cannot see that clearly yet. Hold the phone steady and try again.';
  }
  return text.replace(/\s+/g, ' ').slice(0, 280);
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
