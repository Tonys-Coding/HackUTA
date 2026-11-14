import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, inference, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { attachCallerVision, describeFrame, logEvent } from './vision.mjs';

// Argo: FaceTime helper for low-vision users (Phase 1 = see + speak).
const instructions = `You are Argo, a FaceTime helper for people with low vision.
Keep every reply to one or two short spoken sentences. No markdown, no lists.
When the message includes a camera description, use it to answer. Do not invent details that are not there.
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

/** session.say returns a SpeechHandle — always wait for playout. */
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
      model: 'gemini-2.5-flash',
      apiKey: geminiKey,
    }),
    tts: new elevenlabs.TTS({
      model: 'eleven_turbo_v2_5',
      voiceId: process.env.ELEVEN_VOICE_ID || 'bIHbv24MWmeRgasZH58o',
    }),
  });
}

function createArgoAgent(vision) {
  return voice.Agent.create({
    instructions,
    onUserTurnCompleted: async (_ctx, _chatCtx, newMessage) => {
      // Feed Gemini vision as plain text so the LLM path stays reliable
      // (ImageContent was hanging replies after the greeting).
      const frame = vision.takeFrame() || vision.peekFrame();
      if (!frame) {
        newMessage.content.push(
          'Camera note: no clear frame yet. Ask the caller to hold the phone steady.',
        );
        void logEvent({ type: 'vision.no_frame_on_turn', framesSeen: vision.framesSeen });
        return;
      }

      const userBits = Array.isArray(newMessage.content)
        ? newMessage.content.filter(part => typeof part === 'string').join(' ')
        : '';

      try {
        const description = await describeFrame(frame, userBits);
        newMessage.content.push(`Camera shows: ${description}`);
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
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    // Publish face early so FaceTime has video as soon as the Mac bridges.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0;
    let speaking = false;
    const paint = () =>
      source.captureFrame(new VideoFrame(drawFace(tick++, speaking), WIDTH, HEIGHT, VideoBufferType.RGBA));
    paint();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(paint, 1000 / FPS);

    const caller = await ctx.waitForParticipant();
    const vision = attachCallerVision(ctx.room);

    const session = buildSession();
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
      agent: createArgoAgent(vision),
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
          // Await playout — say() returns a SpeechHandle, not a Promise.
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

          const description = await describeFrame(shot);
          await speak(session, description);
          void logEvent({
            type: 'vision.first_look',
            framesSeen: vision.framesSeen,
            description,
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
