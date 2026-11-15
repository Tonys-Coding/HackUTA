import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, inference, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from '../avatar/face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { wantsFreshLook } from './followup.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { queueLargeTextImessage } from './imessage.mjs';
import {
  THEME_OPTIONS_SPOKEN,
  THEME_SAMPLE_TEXT,
  parseThemeRequest,
  setThemePreference,
  wantsReadWithTheme,
} from './theme-pref.mjs';
import { attachCallerVision, describeFrame, logEvent } from './vision.mjs';

// Argo: FaceTime helper for low-vision users (voice + vision).
// After each successful OCR, fire-and-forget a high-contrast PNG via Chert iMessage
// (FaceTime audio/video stay on the Odyssey fill avatar — 540×1170 from line2).

const instructions = `You are Argo, a FaceTime helper for people with low vision.
Talk like a careful human on a phone call: short turns, then listen.
Default to short spoken answers — usually one sentence. No markdown, no lists, no preamble.
Do not pad with extra explanation. Go longer only if the caller asks for more detail, or if a short answer would be unclear or incomplete.
If they talk over you, stop and wait — never keep monologuing.
When the message says the camera text was already spoken, reply with exactly: Okay.
When answering a follow-up from previously read text: name only the matching items and prices. Do not restate the question. Do not dump the whole menu. Example: "Iced Americano for 4 dollars, and Cold Brew for 4.50."
If nothing matches, say "None that I can see."
If there is no camera description, say you cannot see clearly yet and ask them to hold steady.
For medication or safety labels: only read what is written; never give medical advice; say when unsure.
Theme changes for the large-text iMessage image are handled outside you — if a camera note already covered a theme switch, reply with exactly: Okay.
You are an AI named Argo.`;

const GREETING_TEXT =
  'Hi, I am Argo. Point your camera at something you want me to read.';

/** Prefetch idle RGBA frames before connect so publish isn't blocked on first drawFace. */
const STARTUP_PREFETCH = 24;
/** High FPS through greeting / session start so FaceTime keeps getting fresh keyframes. */
const STARTUP_FPS = 30;
const STARTUP_BOOST_MS = 10000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || /YOUR_/.test(value)) {
    throw new Error(`Missing ${name} in sightline/.env.local`);
  }
  return value;
}

/** session.say returns a SpeechHandle — await playout only outside turn hooks. */
async function speak(session, text, options = {}) {
  const handle = session.say(text, { allowInterruptions: true, ...options });
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    await Promise.race([
      handle.waitForPlayout(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`speak timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } catch (error) {
    console.warn('[argo] speak:', error?.message || error);
    try {
      session.interrupt?.();
    } catch {
      /* ignore */
    }
  }
}

function buildSession() {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey || /YOUR_/.test(geminiKey)) {
    throw new Error('Missing GEMINI_API_KEY (or GOOGLE_API_KEY) in sightline/.env.local');
  }
  requireEnv('ELEVEN_API_KEY');

  return new voice.AgentSession({
    vad: new inference.VAD({ model: 'silero' }),
    stt: new elevenlabs.STT({
      model: 'scribe_v2_realtime',
      languageCode: 'en',
      // Let ElevenLabs commit each sentence itself (commit_strategy=vad). Without this the
      // transcript only commits when the local VAD flushes, which never happened on FaceTime
      // audio, so the caller's words only arrived after hang-up.
      serverVad: {
        vadSilenceThresholdSecs: 0.5,
        minSilenceDurationMs: 400,
      },
    }),
    llm: new google.LLM({
      model: process.env.GEMINI_LLM_MODEL || 'gemini-3.5-flash-lite',
      apiKey: geminiKey,
    }),
    tts: new elevenlabs.TTS({
      model: process.env.ELEVEN_TTS_MODEL || 'eleven_flash_v2_5',
      voiceId: process.env.ELEVEN_VOICE_ID || 'bIHbv24MWmeRgasZH58o',
    }),
    // Natural turn-taking (not model fine-tuning): barge-in + recover after false overlaps.
    turnHandling: {
      endpointing: {
        mode: 'dynamic',
        minDelay: 150,
        // Short pause after "read this" — long maxDelay lets noise stretch the turn to 10s+.
        maxDelay: 500,
      },
      interruption: {
        enabled: true,
        mode: 'adaptive',
        // FaceTime echo / room noise falsely barge-in every few seconds if these are low.
        minDuration: 1600,
        minWords: 3,
        // Resume quickly if the "interrupt" never becomes real words.
        falseInterruptionTimeout: 1200,
        resumeFalseInterruption: true,
        discardAudioIfUninterruptible: false,
        // Soft backchannels ("yeah") near turn edges shouldn't kill the whole reply.
        backchannelBoundary: [1200, 2000],
      },
      preemptiveGeneration: {
        // Off: noisy FaceTime transcripts were starting huge premature turns.
        enabled: false,
        preemptiveTts: false,
      },
    },
  });
}

/**
 * @param {ReturnType<typeof attachCallerVision>} vision
 * @param {{ current: import('@livekit/agents').voice.AgentSession | null }} sessionRef
 * @param {{ current: string }} lastReadRef
 */
function createArgoAgent(vision, sessionRef, lastReadRef) {
  return voice.Agent.create({
    instructions,
    onUserTurnCompleted: async (_ctx, _chatCtx, newMessage) => {
      const session = sessionRef.current;
      const userBits = Array.isArray(newMessage.content)
        ? newMessage.content.filter(part => typeof part === 'string').join(' ')
        : '';

      if (!session) {
        newMessage.content.push('Camera note: session missing. Ask them to try again.');
        return;
      }

      // Voice theme switch for the iMessage PNG. If they also say "read/send this",
      // keep going into OCR — do not short-circuit with a sample only.
      const themeReq = parseThemeRequest(userBits);
      if (themeReq?.kind === 'list') {
        // Not interruptible: FaceTime noise was chopping short confirms mid-word.
        session.say(THEME_OPTIONS_SPOKEN, { allowInterruptions: false });
        newMessage.content.length = 0;
        newMessage.content.push(
          `Already spoken to the caller: "${THEME_OPTIONS_SPOKEN}". Reply with exactly: Okay.`,
        );
        void logEvent({ type: 'theme.list_options', userBits: userBits.slice(0, 120) });
        return;
      }
      if (themeReq?.kind === 'set') {
        setThemePreference(themeReq.theme);
        void logEvent({
          type: 'theme.switched',
          theme: themeReq.theme,
          spoken: themeReq.spoken,
          alsoRead: wantsReadWithTheme(userBits),
          userBits: userBits.slice(0, 120),
        });
        if (!wantsReadWithTheme(userBits)) {
          const sampleText = lastReadRef.current?.trim() || THEME_SAMPLE_TEXT;
          const spoken = `Got it — ${themeReq.spoken}. Sending a sample now.`;
          session.say(spoken, { allowInterruptions: false });
          queueLargeTextImessage(sampleText, event => void logEvent(event), {
            theme: themeReq.theme,
            caption: `Argo large text — ${themeReq.spoken}. Pinch to zoom.`,
          });
          newMessage.content.length = 0;
          newMessage.content.push(`Already spoken to the caller: "${spoken}". Reply with exactly: Okay.`);
          return;
        }
        // Theme saved; fall through so "send me this" still reads the camera.
      }

      // Follow-up about the last OCR — answer from memory (voice only).
      // Theme+read phrases always want a fresh look.
      if (
        !(themeReq?.kind === 'set' && wantsReadWithTheme(userBits)) &&
        !wantsFreshLook(userBits, lastReadRef.current)
      ) {
        newMessage.content.length = 0;
        newMessage.content.push(
          `Caller asked: "${userBits}".\n` +
            `Full text from the last thing the camera read:\n"""\n${lastReadRef.current}\n"""\n` +
            `Give a short spoken answer by default — usually one sentence. Do simple math if asked ` +
            `(for example, per-serving amount times number of servings). ` +
            `Only use facts from that text. No intro, no restating the question, no full dump. ` +
            `Add more detail only if they asked for it or a short answer would be unclear. ` +
            `If none match, say: None that I can see.`,
        );
        void logEvent({
          type: 'vision.follow_up',
          userBits: userBits.slice(0, 120),
          lastReadChars: lastReadRef.current.length,
        });
        return;
      }

      const frame = vision.takeFrame() || vision.peekFrame();
      if (!frame) {
        newMessage.content.push(
          'Camera note: no clear frame yet. Ask the caller to hold the phone steady.',
        );
        void logEvent({ type: 'vision.no_frame_on_turn', framesSeen: vision.framesSeen });
        return;
      }

      try {
        // Fire-and-forget cue — awaiting TTS here blocked the turn for many seconds.
        session.say('Looking.', { allowInterruptions: true });
        const { spoken: description, fullText } = await describeFrame(frame, userBits);

        // Remember the whole label/menu (not just what was spoken) so follow-ups like
        // "what about sodium?" are answered from memory instead of "None that I can see".
        lastReadRef.current = fullText || description;
        // FaceTime echo was chopping every few seconds; keep label reads intact.
        session.say(description, { allowInterruptions: false });
        // Large text goes to iMessage — never touches FaceTime audio/video.
        queueLargeTextImessage(description, event => void logEvent(event));

        newMessage.content.length = 0;
        newMessage.content.push(
          `Already spoken to the caller: "${description}". Reply with exactly: Okay.`,
        );
        void logEvent({
          type: 'vision.turn_described',
          framesSeen: vision.framesSeen,
          description,
          userBits: userBits.slice(0, 120),
        });
      } catch (error) {
        newMessage.content.push('Camera note: vision failed. Say you had trouble seeing just now.');
        void logEvent({
          type: 'vision.turn_error',
          error: String(error?.message || error),
        });
      }
    },
  });
}

const agent = defineAgent({
  entry: async ctx => {
    // Warm frames before connect: first captureFrame after publish must not wait on drawFace JIT.
    const prefetch = [];
    for (let i = 0; i < STARTUP_PREFETCH; i++) prefetch.push(drawFace(i, false));

    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    // Warm waiting-room + call dispatch can put two agents in one room; Mac hears only one.
    // If another agent is already publishing, exit so TTS is not sent into a ignored track.
    const otherAgent = [...ctx.room.remoteParticipants.values()].find(p => {
      const id = p.identity || '';
      return id.startsWith('agent-') || id.startsWith('argo');
    });
    if (otherAgent) {
      console.warn('[argo] duplicate agent in room — exiting', {
        other: otherAgent.identity,
        pid: process.pid,
      });
      return;
    }

    // Publish face ASAP so FaceTime has video as soon as the Mac bridges (line2 pattern).
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = STARTUP_PREFETCH;
    let speaking = false;
    // LiveKit drops / stalls if every frame is stamped 0 — keep a monotonic clock in µs.
    let timestampUs = 0n;
    let frameDurationUs = 1_000_000n / BigInt(STARTUP_FPS);
    const paint = (rgba) => {
      const data = rgba || drawFace(tick++, speaking);
      source.captureFrame(
        new VideoFrame(data, WIDTH, HEIGHT, VideoBufferType.RGBA),
        timestampUs,
      );
      timestampUs += frameDurationUs;
    };
    // Seed the source before publish so the first outbound packet isn't empty/gray.
    for (const frame of prefetch) paint(frame);
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    // Non-blocking cadence only — a sync burst after publish blocked the event loop and starved encode.
    let timer = setInterval(() => paint(), 1000 / STARTUP_FPS);
    const boostEnd = setTimeout(() => {
      clearInterval(timer);
      frameDurationUs = 1_000_000n / BigInt(FPS);
      timer = setInterval(() => paint(), 1000 / FPS);
    }, STARTUP_BOOST_MS);

    // Arm greeting before wait/session so bridge_ready is never missed; speak as soon as session is up.
    /** @type {(session: import('@livekit/agents').voice.AgentSession) => void} */
    let unlockSession;
    const sessionReady = new Promise(resolve => {
      unlockSession = resolve;
    });
    /** @type {{ current: string }} */
    const lastReadRef = { current: '' };
    /** @type {ReturnType<typeof attachCallerVision> | null} */
    let vision = null;

    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      void (async () => {
        console.info('[argo] bridge_ready — waiting for session', { pid: process.pid });
        const session = await sessionReady;
        void logEvent({ type: 'call.bridge_ready' });
        try {
          // FaceTime open-mic noise was eating interruptible greetings for 30–60s.
          // Mute inbound audio and speak uninterruptibly so first TTS can play.
          console.info('[argo] greeting begin', { pid: process.pid });
          try {
            session.input?.setAudioEnabled?.(false);
          } catch {
            /* ignore */
          }
          const t0 = Date.now();
          await speak(session, GREETING_TEXT, {
            allowInterruptions: false,
            timeoutMs: 8_000,
          });
          console.info('[argo] greeting done', { ms: Date.now() - t0, pid: process.pid });
          void logEvent({ type: 'call.greeted', framesSeen: vision?.framesSeen ?? 0 });
        } catch (error) {
          console.error('[argo] greeting failed', error);
          void logEvent({
            type: 'call.greet_error',
            error: String(error?.message || error),
          });
        } finally {
          try {
            session.input?.setAudioEnabled?.(true);
          } catch {
            /* ignore */
          }
        }
      })();
    });
    ctx.addShutdownCallback(async () => stopGreeting());

    const caller = await ctx.waitForParticipant();
    vision = attachCallerVision(ctx.room);

    /** @type {{ current: import('@livekit/agents').voice.AgentSession | null }} */
    const sessionRef = { current: null };
    const session = buildSession();
    sessionRef.current = session;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
    });

    ctx.addShutdownCallback(async () => {
      clearTimeout(boostEnd);
      clearInterval(timer);
      vision?.close();
      await session.close();
      await track.close();
      await source.close();
    });

    console.info('[argo] session.start begin', { caller: caller.identity, pid: process.pid });
    // Start with mic muted so bridge_ready TTS is not queued behind phantom user speech.
    const started = session.start({
      room: ctx.room,
      agent: createArgoAgent(vision, sessionRef, lastReadRef),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        // Must be true: with false, RoomIO never creates the caller's audio stream, so the
        // later session.input.setAudioEnabled(true) has nothing to turn on (agent stays deaf).
        // The greeting mutes/unmutes around itself with setAudioEnabled instead.
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    try {
      await Promise.race([
        started,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('session.start timeout after 12s')), 12_000),
        ),
      ]);
      console.info('[argo] session.start done', { pid: process.pid });
    } catch (error) {
      console.error('[argo] session.start failed', error);
      void logEvent({ type: 'call.session_start_error', error: String(error?.message || error) });
    } finally {
      // Unlock even on timeout so bridge_ready greeting can still attempt audio.
      unlockSession(session);
    }

    // Safety: if bridge_ready never arrives, don't leave the mic muted forever.
    setTimeout(() => {
      try {
        if (sessionRef.current?.input && !sessionRef.current.input.audioEnabled) {
          console.warn('[argo] enabling mic — no greeting unmute yet');
          sessionRef.current.input.setAudioEnabled(true);
        }
      } catch {
        /* ignore */
      }
    }, 15_000);
  },
});

export default agent;

runAgent(agent, {
  file: fileURLToPath(import.meta.url),
  agentName: process.env.AGENT_NAME || 'argo',
});
