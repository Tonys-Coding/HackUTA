import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, inference, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from '../avatar/face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { isMeantForArgo, isStopCommand, wantsFreshLook } from './followup.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { queueLargeTextImessage } from './imessage.mjs';
import { createReadDigest, wantsLargeTextSend } from './large-text-send.mjs';
import {
  THEME_OPTIONS_SPOKEN,
  THEME_SAMPLE_TEXT,
  parseThemeRequest,
  setThemePreference,
  wantsReadWithTheme,
} from './theme-pref.mjs';
import { askAboutPictures, attachCallerVision, describeFrame, logEvent } from './vision.mjs';

// Argo: FaceTime helper for low-vision users (voice + vision).
// FaceTime logic from ImprovedAI-imessage; local PNG iMessage from pre-prod pickHandout.
// Reads are voice-first. Large-text PNGs go to iMessage only when the caller asks
// ("text me that" / "send me the poem") as the matching saved read for this call.

const instructions = `You are Argo, a FaceTime helper for people with low vision.
Talk like a careful human on a phone call: short turns, then listen.
Default to short spoken answers — usually one sentence. No markdown, no lists, no preamble.
Do not pad with extra explanation. Go longer only if the caller asks for more detail, or if a short answer would be unclear or incomplete.
If they talk over you, stop and wait — never keep monologuing.
When the message says the camera text was already spoken, reply with exactly: Okay.
When answering a follow-up from previously read text: name only the matching items and prices. Do not restate the question. Do not dump the whole menu. Example: "Iced Americano for 4 dollars, and Cold Brew for 4.50."
If nothing matches, say "None that I can see."
If there is no camera description, say you cannot see clearly yet and ask them to hold steady.
You look at the camera when the caller asks you about something they are showing you (a question like "how many calories are in two of these?", "what color is this?", or "read this", "describe my screen"). Never claim to see something new unless a camera description was just provided. If they want you to look at something, tell them to show it to the camera and ask you about it.
For medication or safety labels: only read what is written; never give medical advice; say when unsure.
Theme changes for the large-text iMessage image are handled outside you — if a camera note already covered a theme switch, reply with exactly: Okay.
Never claim you texted, messaged, or sent an image — the system sends the large-text iMessage separately when the caller asks (for example "text me that").
Always speak English, even if the caller, the question or background voices are in another language (Hindi, Spanish, etc.) or the text in the picture is in another language (translate it).
You are an AI named Argo.`;

const GREETING_TEXT =
  'Hi, I am Argo. I will help you read anything you are having trouble with. Show me something you are having trouble with and i will help.';

// Said right after the snapshot is grabbed (before we know if it is readable).
const CAPTURED_CUE = 'Got the picture.';
// Said once Gemini confirms the snapshot had readable text, right before the answer. If the
// picture was unreadable, the answer itself asks them to hold it steady and closer instead.
const LOWER_PHONE_CUE = 'You can lower your phone.';
// How many recent pictures Argo remembers per call for follow-up questions.
const MAX_SAVED_PICTURES = 3;

/** Prefetch a couple frames only — big bursts starved STT/VAD on the Mac. */
const STARTUP_PREFETCH = 2;
/** Match steady FPS. Never boost above that — higher rates pushed VAD minutes behind. */
const STARTUP_FPS = 8;
const STARTUP_BOOST_MS = 0;

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
    // Do NOT session.interrupt() here — that cut greetings/answers mid-sentence ("stops talking").
    console.warn('[argo] speak:', error?.message || error);
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
        // 150/500 ms cut questions in half at a natural pause ("tell me the last two sentences …
        // of the first poem"), so Argo answered a fragment. Wait a bit longer for the full sentence.
        // Snappier than 500/1200 — long endpointing felt like Argo "wasn't listening".
        minDelay: 350,
        maxDelay: 900,
      },
      interruption: {
        enabled: true,
        mode: 'adaptive',
        // Lower than 1600 so callers can barge in; echo still needs a real phrase (minWords).
        minDuration: 700,
        minWords: 2,
        // Resume quickly if the "interrupt" never becomes real words.
        falseInterruptionTimeout: 1000,
        resumeFalseInterruption: true,
        discardAudioIfUninterruptible: false,
        // Soft backchannels ("yeah") near turn edges shouldn't kill the whole reply.
        backchannelBoundary: [800, 1600],
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
const wordsOf = text => String(text || '').toLowerCase().match(/[a-z']+/g) || [];
// Things Argo says himself that FaceTime can echo back into his own transcript.
const ARGO_PHRASES = [GREETING_TEXT, CAPTURED_CUE, LOWER_PHONE_CUE].map(t => new Set(wordsOf(t)));

/**
 * True when a transcript is (mostly) Argo hearing his own greeting or cues, not the caller.
 * @param {string} userBits
 */
function isEchoOfArgo(userBits, recentSpoken = []) {
  const words = wordsOf(userBits);
  if (words.length < 3) return false;
  const sets = [...ARGO_PHRASES, ...recentSpoken.map(t => new Set(wordsOf(t)))];
  return sets.some(set => words.filter(w => set.has(w)).length / words.length >= 0.75);
}

/** Remember what Argo just said so an echo of it (e.g. a poem read aloud) is not taken as a request. */
function rememberSpoken(lastReadRef, text) {
  lastReadRef.spoken.push(String(text || ''));
  if (lastReadRef.spoken.length > 4) lastReadRef.spoken.shift();
}

/**
 * @param {ReturnType<typeof createReadDigest>} digest what Argo read this call, for "text me that"
 */
function createArgoAgent(vision, sessionRef, lastReadRef, digest) {
  return voice.Agent.create({
    instructions,
    onUserTurnCompleted: async (_ctx, _chatCtx, newMessage) => {
      const session = sessionRef.current;
      const turnStartedAt = Date.now();
      const userBits = Array.isArray(newMessage.content)
        ? newMessage.content.filter(part => typeof part === 'string').join(' ')
        : '';

      if (!session) {
        newMessage.content.push('Camera note: session missing. Ask them to try again.');
        return;
      }

      // FaceTime can feed Argo's own voice back in (greeting, cues). If this "turn" is just an echo
      // of something Argo said, ignore it entirely instead of replying to himself.
      if (isStopCommand(userBits)) {
        console.info('[argo] stop command turn — staying quiet', { heard: userBits.slice(0, 40) });
        void logEvent({ type: 'turn.stop_command', userBits: userBits.slice(0, 60) });
        throw new voice.StopResponse();
      }

      if (isEchoOfArgo(userBits, lastReadRef.spoken)) {
        console.info('[argo] ignored echo of own speech', { heard: userBits.slice(0, 80) });
        void logEvent({ type: 'turn.echo_ignored', userBits: userBits.slice(0, 120) });
        throw new voice.StopResponse();
      }

      // "Text me that" / "send me the ingredients": large text to iMessage on request.
      const sendReq = wantsLargeTextSend(userBits);

      // Once pictures are saved, background chatter ("yeah, cool, hydration's better") must not make
      // Argo answer (or re-read the poem) on his own. Only questions/requests/small talk get a reply.
      if (lastReadRef.history.length && !sendReq && !isMeantForArgo(userBits)) {
        console.info('[argo] ignored speech not meant for Argo', { heard: userBits.slice(0, 80) });
        void logEvent({ type: 'turn.background_ignored', userBits: userBits.slice(0, 120) });
        throw new voice.StopResponse();
      }

      // Voice theme switch for the iMessage PNG. If they also say "read/send this",
      // keep going into OCR — do not short-circuit with a sample only.
      const themeReq = parseThemeRequest(userBits);
      if (themeReq?.kind === 'list') {
        // Not interruptible: FaceTime noise was chopping short confirms mid-word.
        session.say(THEME_OPTIONS_SPOKEN, { allowInterruptions: true });
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
          session.say(spoken, { allowInterruptions: true });
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

      // Send a matching saved read (poem vs label), not one blob of everything.
      // "text me the poem" after ingredients → poem PNG only; per-entry already-sent tracking.
      if (sendReq) {
        const readyHandout = digest.pickHandout(userBits) || '';
        if (readyHandout) {
          if (digest.alreadySent(readyHandout)) {
            const spoken = 'That one is already in your messages.';
            session.say(spoken, { allowInterruptions: true });
            rememberSpoken(lastReadRef, spoken);
            void logEvent({
              type: 'imessage.digest_duplicate',
              chars: readyHandout.length,
              entries: digest.count(),
              userBits: userBits.slice(0, 120),
            });
            throw new voice.StopResponse();
          }
          const spoken = 'Sending that to your messages now.';
          session.say(spoken, { allowInterruptions: true });
          rememberSpoken(lastReadRef, spoken);
          digest.markSent(readyHandout);
          queueLargeTextImessage(readyHandout, event => void logEvent(event), {
            caption: 'Argo large text — pinch to zoom.',
          });
          void logEvent({
            type: 'imessage.digest_queued',
            chars: readyHandout.length,
            entries: digest.count(),
            userBits: userBits.slice(0, 120),
          });
          throw new voice.StopResponse();
        }
        if (digest.count() > 0) {
          const spoken =
            'I do not have that saved to text yet. Show it again, ask me to read it, then say text me that.';
          session.say(spoken, { allowInterruptions: true });
          rememberSpoken(lastReadRef, spoken);
          void logEvent({
            type: 'imessage.digest_miss',
            entries: digest.count(),
            userBits: userBits.slice(0, 120),
          });
          throw new voice.StopResponse();
        }
      }
      // Nothing saved yet and they asked to text something → look, then send.
      const sendAfterLook = sendReq && digest.count() === 0;

      // Take a new snapshot for explicit requests, for any real question when nothing is saved yet,
      // and for questions about "this / these" once pictures are saved (see followup.wantsFreshLook).
      const explicitLook =
        sendAfterLook ||
        (themeReq?.kind === 'set' && wantsReadWithTheme(userBits)) ||
        wantsFreshLook(
          userBits,
          lastReadRef.history.length > 0,
          lastReadRef.history.map(p => `${p.summary} ${p.fullText}`).join(' ').toLowerCase(),
        );

      // Nothing read yet and no request to look: just talk, and tell them how to ask.
      if (!explicitLook && !lastReadRef.history.length) {
        newMessage.content.length = 0;
        newMessage.content.push(
          `Caller said: "${userBits}".\n` +
            `No picture was taken — you only look at the camera when they ask. Reply briefly ` +
            `and naturally, in English. Do not express sympathy or assume they have a problem; if ` +
            `what they said is unclear or not meant for you, just say you are ready when they are. ` +
            `If they seem to want you to read or identify something, tell them to ` +
            `show it to the camera and ask about it, for example "what is this?".`,
        );
        void logEvent({ type: 'vision.no_look_requested', userBits: userBits.slice(0, 120) });
        return;
      }

      // Follow-up after they lowered the phone: answer from the last few saved snapshots (objects,
      // colors, layout and text; "the first one" works), no new picture. Text memory below on error.
      if (!explicitLook) {
        try {
          const answer = await askAboutPictures(lastReadRef.history, userBits, lastReadRef.taken);
          if ((lastReadRef.stopAt || 0) > turnStartedAt) {
            console.info('[argo] caller said stop — not speaking the late answer');
            throw new voice.StopResponse();
          }
          session.say(answer, { allowInterruptions: true });
          rememberSpoken(lastReadRef, answer);
          newMessage.content.length = 0;
          newMessage.content.push(`Already spoken to the caller: "${answer}". Reply with exactly: Okay.`);
          void logEvent({ type: 'vision.follow_up_image', userBits: userBits.slice(0, 120) });
          return;
        } catch (error) {
          if (error instanceof voice.StopResponse) throw error;
          console.warn('[argo] follow-up from saved picture failed, using text memory', error?.message || error);
        }
      }

      // Follow-up about the last OCR — answer from text memory (voice only), no new snapshot.
      if (!explicitLook) {
        newMessage.content.length = 0;
        newMessage.content.push(
          `Caller asked: "${userBits}".\n` +
            `Text from the last pictures the camera read (most recent last; the question is about ` +
            `the most recent one unless they refer to an earlier one):\n"""\n` +
            lastReadRef.history.map(p => `Picture ${p.n}: ${p.fullText || p.summary}`).join('\n') +
            `\n"""\n` +
            `Give a short spoken answer in English — usually one sentence. Do simple math if asked ` +
            `(for example, per-serving amount times number of servings). ` +
            `Only use facts from that text. No intro, no restating the question, no full dump. ` +
            `Add more detail only if they asked for it or a short answer would be unclear. ` +
            `If none match, say: None that I can see. If they want you to look at something ` +
            `new, they can show it and ask about it.`,
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
        session.say(CAPTURED_CUE, { allowInterruptions: true });
        const { spoken: description, fullText, seen, image } = await describeFrame(frame, userBits);
        // Picture clearly showed text or an object (not blurry/dark).
        const readable = seen;

        // New picture came back dark/unreadable (e.g. phone already lowered) but we have saved
        // pictures: answer from those instead of asking them to hold the phone up again.
        if (!readable && lastReadRef.history.length) {
          try {
            const answer = await askAboutPictures(lastReadRef.history, userBits, lastReadRef.taken);
            console.info('[argo] new picture unreadable — answered from saved pictures');
            if ((lastReadRef.stopAt || 0) > turnStartedAt) {
              console.info('[argo] caller said stop — not speaking the late answer');
              throw new voice.StopResponse();
            }
            session.say(answer, { allowInterruptions: true });
            rememberSpoken(lastReadRef, answer);
            newMessage.content.length = 0;
            newMessage.content.push(`Already spoken to the caller: "${answer}". Reply with exactly: Okay.`);
            void logEvent({ type: 'vision.dark_fallback_to_saved', userBits: userBits.slice(0, 120) });
            return;
          } catch (error) {
            if (error instanceof voice.StopResponse) throw error;
            console.warn('[argo] saved-picture fallback failed', error?.message || error);
          }
        }

        // Remember the last few good snapshots (picture + full text + what was said) so follow-ups
        // like "what about sodium?" or "what was on the first one?" work after they lower the phone.
        // An unreadable snapshot is not saved and does not wipe the earlier ones.
        if (readable) {
          lastReadRef.taken += 1;
          lastReadRef.history.push({ n: lastReadRef.taken, image, fullText, summary: description });
          if (lastReadRef.history.length > MAX_SAVED_PICTURES) lastReadRef.history.shift();
          lastReadRef.current = fullText;
          digest.append(fullText || description, description);
          console.info('[argo] saved picture', {
            n: lastReadRef.taken,
            remembering: lastReadRef.history.map(p => p.n),
          });
        }
        // Only tell them to lower the phone once we know the snapshot was readable.
        const spokenOut = readable ? `${LOWER_PHONE_CUE} ${description}` : description;
        // FaceTime echo was chopping every few seconds; keep label reads intact.
        if ((lastReadRef.stopAt || 0) > turnStartedAt) {
          console.info('[argo] caller said stop — not speaking the late answer');
          throw new voice.StopResponse();
        }
        session.say(spokenOut, { allowInterruptions: true });
        rememberSpoken(lastReadRef, spokenOut);
        // Large text goes to iMessage only when asked — never touches FaceTime audio/video.
        const sendText = (fullText || description || '').trim();
        if (sendAfterLook && readable && sendText) {
          digest.markSent(sendText);
          queueLargeTextImessage(sendText, event => void logEvent(event), {
            caption: 'Argo large text — what I just read. Pinch to zoom.',
          });
          void logEvent({
            type: 'imessage.digest_queued_after_look',
            chars: sendText.length,
            userBits: userBits.slice(0, 120),
          });
        }

        newMessage.content.length = 0;
        newMessage.content.push(
          `Already spoken to the caller: "${spokenOut}". Reply with exactly: Okay.`,
        );
        void logEvent({
          type: 'vision.turn_described',
          framesSeen: vision.framesSeen,
          description,
          userBits: userBits.slice(0, 120),
        });
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
    let painting = false;
    /** Reuse the last idle bitmap so quiet periods don't redraw the whole scene every tick. */
    let idleFrame = prefetch[prefetch.length - 1] || null;
    let lastSpoke = false;
    const paint = (rgba) => {
      // Never stack drawFace on the event loop — that pushed VAD 10s+ behind realtime.
      if (painting) return;
      painting = true;
      try {
        let data = rgba;
        if (!data) {
          if (speaking || lastSpoke || !idleFrame || tick % 4 === 0) {
            data = drawFace(tick++, speaking);
            if (!speaking) idleFrame = data;
          } else {
            data = idleFrame;
            tick++;
          }
          lastSpoke = speaking;
        }
        source.captureFrame(
          new VideoFrame(data, WIDTH, HEIGHT, VideoBufferType.RGBA),
          timestampUs,
        );
        timestampUs += frameDurationUs;
      } finally {
        painting = false;
      }
    };
    // Seed the source before publish so the first outbound packet isn't empty/gray.
    for (const frame of prefetch) paint(frame);
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    // Steady low FPS only — no startup boost (that used to starve VAD for the whole greeting).
    const timer = setInterval(() => paint(), 1000 / Math.max(STARTUP_FPS, FPS));

    // Arm greeting before wait/session so bridge_ready is never missed; speak as soon as session is up.
    /** @type {(session: import('@livekit/agents').voice.AgentSession) => void} */
    let unlockSession;
    const sessionReady = new Promise(resolve => {
      unlockSession = resolve;
    });
    /** @type {{ current: string }} */
    /** Last few good snapshots this call (oldest first), plus the latest text for theme samples.
     * @type {{ current: string, taken: number, history: Array<{ n: number, image: { mimeType: string, base64: string }, fullText: string, summary: string }> }} */
    const lastReadRef = { current: '', taken: 0, history: [], spoken: [] };
    const readDigest = createReadDigest();
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
            allowInterruptions: true,
            // Two-sentence greeting runs ~7-8 s; 8 s timed out and cut it off.
            timeoutMs: 15_000,
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
    // "Stop" / "Argos stop" / "wait" / "cancel": interrupt right away, even an uninterruptible
    // readout. Uses the live transcript, which arrives even while Argo is talking.
    let lastStopAt = 0;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, event => {
      if (!isStopCommand(event.transcript)) return;
      const now = Date.now();
      if (now - lastStopAt < 1500) return;
      lastStopAt = now;
      lastReadRef.stopAt = now;
      console.info('[argo] stop command — interrupting', { heard: String(event.transcript).slice(0, 40) });
      void logEvent({ type: 'speech.stopped_by_caller' });
      try {
        void Promise.resolve(session.interrupt({ force: true })).catch(() => {});
      } catch {
        /* nothing playing */
      }
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
    });

    ctx.addShutdownCallback(async () => {
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
      agent: createArgoAgent(vision, sessionRef, lastReadRef, readDigest),
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
