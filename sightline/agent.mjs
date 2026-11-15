import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, inference, voice } from '@livekit/agents';
import * as anam from '@livekit/agents-plugin-anam';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from '../avatar/face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { contentFitsLastRead, routeTurn } from './followup.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { queueLargeTextImessage } from './imessage.mjs';
import { createReadDigest, wantsLargeTextSend } from './large-text-send.mjs';
import { SIMLI_DEFAULT_FACE_ID, SimliAvatarSession } from './simli-avatar.mjs';
import {
  THEME_OPTIONS_SPOKEN,
  THEME_SAMPLE_TEXT,
  parseThemeRequest,
  setThemePreference,
  wantsReadWithTheme,
} from './theme-pref.mjs';
import { attachCallerVision, describeFrame, logEvent } from './vision.mjs';

// Argo: FaceTime helper for low-vision users (voice + vision).
// OCR is voice-first; large-text PNGs go to iMessage only on request (session digest).
// Video: Odyssey drawFace by default; hosted avatar when SIMLI_ENABLED or ANAM_ENABLED.

/** Stock Anam "Mia" — replace with a custom Lab avatar ID when you have one. */
const ANAM_STOCK_MIA = 'edf6fdcb-acab-44b8-b974-ded72665ee26';

function flagEnabled(name) {
  const v = process.env[name];
  return v === '1' || v === 'true';
}

function simliEnabled() {
  return flagEnabled('SIMLI_ENABLED');
}

function anamEnabled() {
  // Simli wins when both are on
  return flagEnabled('ANAM_ENABLED') && !simliEnabled();
}

function hostedAvatarEnabled() {
  return simliEnabled() || anamEnabled();
}

const instructions = `You are Argo, a FaceTime helper for people with low vision.
Talk like a careful human on a phone call: short turns, then listen.
Default to short spoken answers — usually one sentence. No markdown, no lists, no preamble.
Do not pad with extra explanation. Go longer only if the caller asks for more detail, or if a short answer would be unclear or incomplete.
If they talk over you, stop and wait — never keep monologuing.
Never say "Okay" as a filler, closing, or acknowledgment — just stop when you are done.
When answering a follow-up from previously read text: name only the matching items and prices. Do not restate the question. Do not dump the whole menu. Example: "Iced Americano for 4 dollars, and Cold Brew for 4.50."
If nothing matches, say "None that I can see."
If there is no camera description, say you cannot see clearly yet and ask them to hold steady.
For medication or safety labels: only read what is written; never give medical advice; say when unsure.
Never claim you texted, messaged, or sent an image — the system sends iMessage large text separately when the caller asks.
You are an AI named Argo.`;

// TEST ONLY — revert greeting + accent voice when done poking at this.
const GREETING_TEXT =
  'Ahhh yess. Hi, I am Argo. Point your camera at something you want me to read. Say text me that when you want the large text in Messages.';
/** TEST ONLY — keep Will until a library voice is added to this ElevenLabs account.
 *  Ahmed (9lJhQTNhE6XNSstSyMzH) returned voice_id_does_not_exist and killed speech. */
const TEST_VOICE_ID = 'bIHbv24MWmeRgasZH58o';

/** Warm a couple idle frames before connect (not dozens — each is ~10MB). */
const STARTUP_PREFETCH = 2;
/** Keep startup FPS at publish FPS — 30fps × 10MB copies starved STT/TTS. */
const STARTUP_FPS = 12;
const STARTUP_BOOST_MS = 4000;

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
      // TEST ONLY — prefers TEST_VOICE_ID over env/default Will.
      voiceId: process.env.ELEVEN_VOICE_ID || TEST_VOICE_ID,
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
 * @param {ReturnType<typeof createReadDigest>} digest
 */
function createArgoAgent(vision, sessionRef, lastReadRef, digest) {
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
        void logEvent({ type: 'theme.list_options', userBits: userBits.slice(0, 120) });
        // Skip LLM so it does not tack on "Okay" after session.say.
        throw new voice.StopResponse();
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
          throw new voice.StopResponse();
        }
        // Theme saved; fall through so "send me this" still reads the camera.
      }

      // On-demand large-text PNG. If they asked to send a topic we don't have yet,
      // fall through to a fresh camera read, then send that (don't ship the old label).
      const sendReq = wantsLargeTextSend(userBits);
      const readyHandout = digest.digest() || lastReadRef.current?.trim() || '';
      const handoutFits =
        Boolean(readyHandout) &&
        (contentFitsLastRead(userBits, readyHandout) ||
          /text me that|send (me )?(that|it)|large text|what you (just )?read|everything you read/i.test(
            userBits,
          ));
      if (sendReq && readyHandout && handoutFits) {
        if (digest.alreadySent(readyHandout)) {
          session.say('That large text is already in your messages.', {
            allowInterruptions: false,
          });
          void logEvent({
            type: 'imessage.digest_duplicate',
            chars: readyHandout.length,
            entries: digest.count(),
          });
          throw new voice.StopResponse();
        }
        const n = digest.count();
        const spoken =
          n > 1
            ? `Sending ${n} reads to your messages now.`
            : 'Sending that to your messages now.';
        session.say(spoken, { allowInterruptions: false });
        digest.markSent(readyHandout);
        queueLargeTextImessage(readyHandout, event => void logEvent(event), {
          caption:
            n > 1
              ? `Argo large text — ${n} reads this call. Pinch to zoom.`
              : 'Argo large text — what I just read. Pinch to zoom.',
        });
        void logEvent({
          type: 'imessage.digest_queued',
          chars: readyHandout.length,
          entries: n,
          userBits: userBits.slice(0, 120),
        });
        throw new voice.StopResponse();
      }
      const sendAfterLook = sendReq && !handoutFits;

      // Quick router: follow up on last OCR vs fresh camera look.
      const turnRoute =
        sendAfterLook || (themeReq?.kind === 'set' && wantsReadWithTheme(userBits))
          ? 'fresh'
          : routeTurn(userBits, lastReadRef.current);
      if (turnRoute === 'follow_up') {
        newMessage.content.length = 0;
        newMessage.content.push(
          `Caller asked: "${userBits}".\n` +
            `Full text from the last thing the camera read:\n"""\n${lastReadRef.current}\n"""\n` +
            `Answer that follow-up from this text only. Short spoken answer — usually one sentence. ` +
            `Do simple math if asked. You may briefly infer what the item likely is when they ask ` +
            `(for example from ingredients or a product name), but stay grounded in the text. ` +
            `Do NOT re-read or dump the whole label/list. No intro, no restating the question. ` +
            `If none match, say: None that I can see.`,
        );
        void logEvent({
          type: 'vision.follow_up',
          route: 'follow_up',
          userBits: userBits.slice(0, 120),
          lastReadChars: lastReadRef.current.length,
        });
        return;
      }
      void logEvent({
        type: 'vision.route',
        route: turnRoute,
        userBits: userBits.slice(0, 120),
        lastReadChars: lastReadRef.current?.length || 0,
      });

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
        session.say(sendAfterLook ? 'Looking, then I will text it.' : 'Looking.', {
          allowInterruptions: true,
        });
        const { spoken: description, fullText } = await describeFrame(frame, userBits);

        // Remember the whole label/menu (not just what was spoken) so follow-ups like
        // "what about sodium?" are answered from memory instead of "None that I can see".
        const remembered = fullText || description;
        lastReadRef.current = remembered;
        digest.append(remembered);
        // FaceTime echo was chopping every few seconds; keep label reads intact.
        session.say(description, { allowInterruptions: false });

        if (sendAfterLook && remembered.trim()) {
          digest.markSent(remembered);
          queueLargeTextImessage(remembered, event => void logEvent(event), {
            caption: 'Argo large text — what I just read. Pinch to zoom.',
          });
          void logEvent({
            type: 'imessage.digest_queued_after_look',
            chars: remembered.length,
            userBits: userBits.slice(0, 120),
          });
        }

        void logEvent({
          type: 'vision.turn_described',
          framesSeen: vision.framesSeen,
          description,
          digestEntries: digest.count(),
          freshLook: true,
          userBits: userBits.slice(0, 120),
        });
        // Skip LLM so it does not tack on "Okay" after the OCR was already spoken.
        throw new voice.StopResponse();
      } catch (error) {
        if (error instanceof voice.StopResponse) throw error;
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
    const useSimli = simliEnabled();
    const useAnam = anamEnabled();
    const useHostedAvatar = hostedAvatarEnabled();
    if (useSimli && !process.env.SIMLI_API_KEY) {
      throw new Error('SIMLI_ENABLED=1 but SIMLI_API_KEY is missing (https://app.simli.com)');
    }
    if (useAnam && !process.env.ANAM_API_KEY) {
      throw new Error('ANAM_ENABLED=1 but ANAM_API_KEY is missing (get one at https://lab.anam.ai)');
    }

    /** @type {Uint8Array[]} */
    const prefetch = [];
    if (!useHostedAvatar) {
      console.info('[argo] warming avatar frames', { prefetch: STARTUP_PREFETCH, pid: process.pid });
      for (let i = 0; i < STARTUP_PREFETCH; i++) prefetch.push(drawFace(i, false));
      console.info('[argo] avatar warm done', { pid: process.pid });
    }

    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    console.info('[argo] connected', { pid: process.pid });

    // Warm waiting-room + call dispatch can put two agents in one room; Mac hears only one.
    const otherAgent = [...ctx.room.remoteParticipants.values()].find(p => {
      const id = p.identity || '';
      return (
        (id.startsWith('agent-') || id.startsWith('argo')) &&
        !id.includes('anam-avatar') &&
        !id.includes('simli-avatar')
      );
    });
    if (otherAgent) {
      console.warn('[argo] duplicate agent in room — exiting', {
        other: otherAgent.identity,
        pid: process.pid,
      });
      return;
    }

    /** @type {import('@livekit/rtc-node').VideoSource | null} */
    let source = null;
    /** @type {import('@livekit/rtc-node').LocalVideoTrack | null} */
    let track = null;
    let tick = STARTUP_PREFETCH;
    let speaking = false;
    let timestampUs = 0n;
    let frameDurationUs = 1_000_000n / BigInt(STARTUP_FPS);
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let boostEnd = null;

    if (!useHostedAvatar) {
      // Publish Odyssey face ASAP so FaceTime has video as soon as the Mac bridges.
      source = new VideoSource(WIDTH, HEIGHT);
      track = LocalVideoTrack.createVideoTrack('agent-video', source);
      let painting = false;
      const paint = rgba => {
        // Never stack draws — backlog was blanking FaceTime (gray flashes).
        if (painting) return;
        painting = true;
        try {
          const data = rgba || drawFace(tick++, speaking);
          source.captureFrame(
            new VideoFrame(data, WIDTH, HEIGHT, VideoBufferType.RGBA),
            timestampUs,
          );
          timestampUs += frameDurationUs;
        } finally {
          painting = false;
        }
      };
      for (const frame of prefetch) paint(frame);
      await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
      timer = setInterval(() => paint(), 1000 / STARTUP_FPS);
      boostEnd = setTimeout(() => {
        if (timer) clearInterval(timer);
        frameDurationUs = 1_000_000n / BigInt(FPS);
        timer = setInterval(() => paint(), 1000 / FPS);
      }, STARTUP_BOOST_MS);
    } else {
      console.info('[argo] hosted avatar mode — skipping local drawFace track', {
        provider: useSimli ? 'simli' : 'anam',
        faceId: useSimli
          ? process.env.SIMLI_FACE_ID || SIMLI_DEFAULT_FACE_ID
          : process.env.ANAM_AVATAR_ID || ANAM_STOCK_MIA,
        pid: process.pid,
      });
    }

    /** @type {(session: import('@livekit/agents').voice.AgentSession) => void} */
    let unlockSession;
    const sessionReady = new Promise(resolve => {
      unlockSession = resolve;
    });
    /** @type {{ current: string }} */
    const lastReadRef = { current: '' };
    const readDigest = createReadDigest();
    /** @type {ReturnType<typeof attachCallerVision> | null} */
    let vision = null;

    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      void (async () => {
        console.info('[argo] bridge_ready — waiting for session', { pid: process.pid });
        const session = await sessionReady;
        void logEvent({ type: 'call.bridge_ready' });
        try {
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

    console.info('[argo] waiting for participant', { pid: process.pid });
    const caller = await ctx.waitForParticipant();
    console.info('[argo] participant joined', { caller: caller.identity, pid: process.pid });
    vision = attachCallerVision(ctx.room);

    /** @type {{ current: import('@livekit/agents').voice.AgentSession | null }} */
    const sessionRef = { current: null };
    const session = buildSession();
    sessionRef.current = session;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
    });

    if (useSimli) {
      const faceId = process.env.SIMLI_FACE_ID || SIMLI_DEFAULT_FACE_ID;
      const avatar = new SimliAvatarSession({
        apiKey: process.env.SIMLI_API_KEY,
        faceId,
        maxSessionLength: 600,
        maxIdleTime: 300,
        // Trinity-2 portrait 9:16 for FaceTime
        streamingWidth: 768,
        streamingHeight: 1366,
        avatarPositionX: 0.5,
        avatarPositionY: 1.0,
      });
      console.info('[argo] Simli avatar.start', { faceId, pid: process.pid });
      await avatar.start(session, ctx.room);
      void logEvent({ type: 'avatar.simli_started', faceId });
    } else if (useAnam) {
      const avatarId = process.env.ANAM_AVATAR_ID || ANAM_STOCK_MIA;
      const avatarName = process.env.ANAM_AVATAR_NAME || 'Mia';
      const avatar = new anam.AvatarSession({
        apiKey: process.env.ANAM_API_KEY,
        personaConfig: {
          name: avatarName,
          avatarId,
          avatarModel: 'cara-4',
          directorNotes: {
            customStylePrompt:
              'Stay calm and steady. Minimal head motion. Soft blinks only. Keep the mouth a simple dog muzzle — no human lips.',
            customIdlingStylePrompt:
              'Almost still while listening. Tiny occasional blink. No fidgeting.',
            expressivity: 0.2,
          },
        },
        sessionOptions: {
          videoWidth: 768,
          videoHeight: 1152,
        },
      });
      console.info('[argo] Anam avatar.start', {
        avatarId,
        avatarName,
        avatarModel: 'cara-4',
        expressivity: 0.2,
        pid: process.pid,
      });
      await avatar.start(session, ctx.room);
      void logEvent({ type: 'avatar.anam_started', avatarId, avatarName });
    }

    ctx.addShutdownCallback(async () => {
      if (boostEnd) clearTimeout(boostEnd);
      if (timer) clearInterval(timer);
      vision?.close();
      await session.close();
      if (track) await track.close();
      if (source) await source.close();
    });

    console.info('[argo] session.start begin', {
      caller: caller.identity,
      simli: useSimli,
      anam: useAnam,
      pid: process.pid,
    });
    const started = session.start({
      room: ctx.room,
      agent: createArgoAgent(vision, sessionRef, lastReadRef, readDigest),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      // Hosted avatars redirect session.output.audio to the avatar worker.
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
      unlockSession(session);
    }

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
