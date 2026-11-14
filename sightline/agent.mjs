import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, inference, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from '../avatar/face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { createMagnifier, wantsFreshLook } from './magnifier.mjs';
import { withThinking } from './thinking.mjs';
import { attachCallerVision, describeFrame, logEvent } from './vision.mjs';

// Argo: FaceTime helper for low-vision users (Phase 2 = speak + large-text magnifier).
const instructions = `You are Argo, a FaceTime helper for people with low vision.
Keep every reply to one short spoken sentence. No markdown, no lists.
When the message says the camera text was already spoken, stay silent or say only "Okay." Do not repeat the menu.
When the message includes previously read text and a follow-up question, answer from that text only in one short sentence.
If there is no camera description, say you cannot see clearly yet and ask them to hold the phone steady.
For medication or safety labels: only read what is written; never give medical advice; say when you are unsure.
Be clear that you are an AI named Argo.`;

const GREETING_TEXT =
  'Hi, I am Argo. Point your camera at something you want me to read.';

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
  await handle.waitForPlayout();
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
    }),
    llm: new google.LLM({
      // Cheap/fast spoken replies; vision does the heavy OCR work.
      model: process.env.GEMINI_LLM_MODEL || 'gemini-3.5-flash-lite',
      apiKey: geminiKey,
    }),
    tts: new elevenlabs.TTS({
      // Flash is cheaper + lower latency than Turbo for the same voice quality tier.
      model: process.env.ELEVEN_TTS_MODEL || 'eleven_flash_v2_5',
      voiceId: process.env.ELEVEN_VOICE_ID || 'bIHbv24MWmeRgasZH58o',
    }),
  });
}

/**
 * @param {ReturnType<typeof attachCallerVision>} vision
 * @param {{ current: import('@livekit/agents').voice.AgentSession | null }} sessionRef
 * @param {{ current: string }} lastReadRef
 * @param {ReturnType<typeof createMagnifier>} magnifier
 */
function createArgoAgent(vision, sessionRef, lastReadRef, magnifier) {
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

      // Follow-up about the last OCR — answer from memory, keep large text up.
      if (!wantsFreshLook(userBits, lastReadRef.current)) {
        magnifier.show(lastReadRef.current);
        newMessage.content.push(
          `Previously read aloud (also shown large on their screen): "${lastReadRef.current}". ` +
            `Answer the caller's question in one short spoken sentence using only that text. Do not invent items.`,
        );
        void logEvent({
          type: 'magnifier.follow_up',
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
        // Fillers while Gemini runs — this is the silent gap callers notice.
        const description = await withThinking(session, () => describeFrame(frame, userBits), {
          everyMs: 3500,
        });

        lastReadRef.current = description;
        magnifier.show(description);

        // Speak the full read immediately (fillers already interrupted above).
        session.say(description, { allowInterruptions: false });

        // Stop the LLM from saying a useless "Got it" over the menu read.
        newMessage.content.length = 0;
        newMessage.content.push(
          `Already spoken to the caller and shown as large text: "${description}". Reply with exactly: Okay.`,
        );
        void logEvent({
          type: 'vision.turn_described',
          framesSeen: vision.framesSeen,
          description,
          userBits: userBits.slice(0, 120),
          magnifier: true,
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
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    const magnifier = createMagnifier();
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0;
    let speaking = false;
    // Avatar by default; swap to large text while magnifier.isShowing().
    const paint = () => {
      const rgba = magnifier.isShowing()
        ? magnifier.draw(tick++)
        : drawFace(tick++, speaking);
      source.captureFrame(new VideoFrame(rgba, WIDTH, HEIGHT, VideoBufferType.RGBA));
    };
    paint();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(paint, 1000 / FPS);

    const caller = await ctx.waitForParticipant();
    const vision = attachCallerVision(ctx.room);

    /** @type {{ current: import('@livekit/agents').voice.AgentSession | null }} */
    const sessionRef = { current: null };
    /** @type {{ current: string }} */
    const lastReadRef = { current: '' };
    const session = buildSession();
    sessionRef.current = session;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      speaking = event.newState === 'speaking';
    });

    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      vision.close();
      await session.close();
      await track.close();
      await source.close();
    });

    await session.start({
      room: ctx.room,
      agent: createArgoAgent(vision, sessionRef, lastReadRef, magnifier),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });

    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      void (async () => {
        void logEvent({ type: 'call.bridge_ready', caller: caller.identity });
        try {
          await speak(session, GREETING_TEXT);

          const shot = vision.peekFrame();
          if (!shot) {
            await speak(
              session,
              'I am ready, but I do not see your camera yet. Make sure this is a FaceTime Video call.',
            );
            void logEvent({ type: 'vision.no_frame', framesSeen: vision.framesSeen });
            return;
          }

          const description = await withThinking(session, () => describeFrame(shot), {
            everyMs: 3500,
          });
          lastReadRef.current = description;
          magnifier.show(description);
          await speak(session, description);
          void logEvent({
            type: 'vision.first_look',
            framesSeen: vision.framesSeen,
            description,
            magnifier: true,
          });
        } catch (error) {
          console.error('[argo] greeting / first look failed', error);
          void logEvent({
            type: 'vision.first_look_error',
            error: String(error?.message || error),
          });
          try {
            await speak(
              session,
              'I had trouble reading the camera just now. Point at something and ask me what I see.',
            );
          } catch {
            /* call may have ended */
          }
        }
      })();
    });
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

runAgent(agent, {
  file: fileURLToPath(import.meta.url),
  agentName: process.env.AGENT_NAME || 'argo',
});
