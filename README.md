# Argo (HackUTA × Chert)

FaceTime + iMessage agent for **low-vision** users: talking magnifier + find-my-things memory.

Stack: Chert FaceTime line → LiveKit agent (`sightline/` folder, agent name **argo**) → Gemini vision → MongoDB Atlas → Express API (`server/`) → React dashboard (later).

## What you must set up (your side)

Do these once. Put secrets only in `.env.local` files — never in chat or git.

### 1. ElevenLabs API key (required for voice)
1. https://elevenlabs.io → Profile → API Key  
2. Put in **both** root `.env.local` and `sightline/.env.local` as `ELEVEN_API_KEY=...`  
3. Optional: set `ELEVEN_VOICE_ID` to a voice from the voice library  

### 2. Gemini API key (LLM + vision)
1. Paste into **both** root `.env.local` and `sightline/.env.local` as `GEMINI_API_KEY=...`  
2. Also set `GOOGLE_API_KEY` to the same value in `sightline/.env.local` (LiveKit Google plugin)

### 3. MongoDB Atlas free cluster
1. https://cloud.mongodb.com → create a free cluster  
2. Database Access → user + password  
3. Network Access → allow your IP (or `0.0.0.0/0` for hackathon)  
4. Connect → Drivers → copy URI into root `.env.local` as `MONGODB_URI=...`  
5. Optional: `MONGODB_DB=sightline`

### 4. LiveKit
Trial needs your own LiveKit Cloud project. Put `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `sightline/.env.local` (all three from the same project).

### 5. Chert
- Sign in with `npx @trychert/facetime@0.1.0-beta.21 onboard`  
- Console: https://app.trychert.com/overview  

## Run locally (after keys)

```bash
# Terminal A — API + Mongo logging
cd server && npm install && npm run dev

# Terminal B — LiveKit / Chert agent
cd sightline && npm install && npm start

# Terminal C — hold the FaceTime line
cd sightline && npx @trychert/facetime@0.1.0-beta.21 doctor --agent argo
npx @trychert/facetime@0.1.0-beta.21 dev --agent argo
```

Then FaceTime the line shown in the console (Video). Hang up when done; Ctrl+C `chert dev` to free the line.

## Repo layout

| Path | Role |
|------|------|
| `sightline/` | LiveKit agent **argo** (ElevenLabs + Gemini + camera track) |
| `server/` | Express API for events, sightings, privacy delete |
| `plan.md` | Confirmed product plan |
| `.env.example` | Template for root secrets |

## Privacy
- Frames/sightings TTL: **7 days** (Mongo TTL indexes)  
- Command (wired later): text **delete my data**
