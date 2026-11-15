/**
 * Minimal Simli LiveKit avatar session for Node agents.
 * Mirrors livekit-plugins-simli (Python): compose/token → /integrations/livekit/agents
 * → DataStreamAudioOutput to simli-avatar-agent.
 */
import { voice } from '@livekit/agents';
import { TrackKind } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const SIMLI_API = 'https://api.simli.ai';
/** Simli default Trinity-2 face (human). Swap via SIMLI_FACE_ID after custom gen. */
export const SIMLI_DEFAULT_FACE_ID = '14c60d62-6ebf-424d-b626-1f4f91c33b04';
const AVATAR_IDENTITY = 'simli-avatar-agent';
const SAMPLE_RATE = 16_000;

async function mintAvatarJoinToken({ roomName, publishOnBehalf, apiKey, apiSecret }) {
  const at = new AccessToken(apiKey, apiSecret, {
    identity: AVATAR_IDENTITY,
    name: AVATAR_IDENTITY,
    ttl: '60s',
  });
  at.kind = 'agent';
  at.attributes = { 'lk.publish_on_behalf': publishOnBehalf };
  at.addGrant({ roomJoin: true, room: roomName });
  return at.toJwt();
}

async function postJson(url, { headers = {}, body, apiKey }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-simli-api-key': apiKey } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Simli ${url} failed: ${res.status} ${text.slice(0, 400)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export class SimliAvatarSession {
  /**
   * @param {{
   *   apiKey: string,
   *   faceId?: string,
   *   maxSessionLength?: number,
   *   maxIdleTime?: number,
   *   streamingWidth?: number,
   *   streamingHeight?: number,
   * }} opts
   */
  constructor(opts) {
    this.opts = opts;
  }

  get avatarIdentity() {
    return AVATAR_IDENTITY;
  }

  /**
   * @param {import('@livekit/agents').voice.AgentSession} agentSession
   * @param {import('@livekit/rtc-node').Room} room
   */
  async start(agentSession, room) {
    const apiKey = this.opts.apiKey || process.env.SIMLI_API_KEY;
    if (!apiKey) throw new Error('SIMLI_API_KEY is required');

    const livekitUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitUrl || !lkKey || !lkSecret) {
      throw new Error('LIVEKIT_URL/API_KEY/API_SECRET must be set for Simli');
    }

    const faceId = this.opts.faceId || process.env.SIMLI_FACE_ID || SIMLI_DEFAULT_FACE_ID;
    const localIdentity = room.localParticipant?.identity || 'agent';

    const tokenBody = {
      faceId,
      handleSilence: true,
      maxSessionLength: this.opts.maxSessionLength ?? 600,
      maxIdleTime: this.opts.maxIdleTime ?? 300,
    };
    if (this.opts.streamingWidth != null) tokenBody.streaming_width = this.opts.streamingWidth;
    if (this.opts.streamingHeight != null) tokenBody.streaming_height = this.opts.streamingHeight;
    // Portrait 9:16 for FaceTime when dimensions set
    if (this.opts.avatarPositionX != null) tokenBody.avatar_position_x = this.opts.avatarPositionX;
    if (this.opts.avatarPositionY != null) tokenBody.avatar_position_y = this.opts.avatarPositionY;

    console.info('[argo] Simli compose/token', { faceId, pid: process.pid });
    const tokenRes = await postJson(`${SIMLI_API}/compose/token`, {
      apiKey,
      body: tokenBody,
    });
    if (tokenRes.warnings?.length) {
      console.warn('[argo] Simli token warnings', tokenRes.warnings);
    }
    const sessionToken = tokenRes.session_token;
    if (!sessionToken) {
      throw new Error(`Simli token missing session_token: ${JSON.stringify(tokenRes).slice(0, 300)}`);
    }

    const livekitToken = await mintAvatarJoinToken({
      roomName: room.name,
      publishOnBehalf: localIdentity,
      apiKey: lkKey,
      apiSecret: lkSecret,
    });

    console.info('[argo] Simli livekit/agents start', { room: room.name, pid: process.pid });
    await postJson(`${SIMLI_API}/integrations/livekit/agents`, {
      body: {
        session_token: sessionToken,
        livekit_token: livekitToken,
        livekit_url: livekitUrl,
      },
    });

    agentSession.output.audio = new voice.DataStreamAudioOutput({
      room,
      destinationIdentity: AVATAR_IDENTITY,
      sampleRate: SAMPLE_RATE,
      waitRemoteTrack: TrackKind.KIND_VIDEO,
    });
  }
}
