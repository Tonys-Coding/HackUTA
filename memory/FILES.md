# Argo / HackUTA — file map

First-party source only (what we wrote or customized). Framework code lives under `*/node_modules` and is not listed line-by-line.

**Team / ownership:** see `OWNERSHIP.md` and `../handoff.md`.

---

## Folders

| Path | Role |
|------|------|
| `sightline/` | LiveKit/Chert FaceTime agent (**Argo**). Speaks, sees, publishes avatar video. |
| `avatar/` | Odyssey-themed RGBA face frames (warrior). Same `drawFace(tick, speaking)` contract as Chert’s starter face. |
| `server/` | Express + MongoDB API for events / future dashboard & privacy wipe. |
| `memory/` | Defense notes: this file map + implementation log (whiteboard-test). |

Secrets stay in `.env.local` (gitignored). Never commit keys.

---

## Crucial files

### Agent (FaceTime path)

| File | Lines | What it does | Used by |
|------|------:|--------------|---------|
| `sightline/agent.mjs` | ~220 | Entry: builds VAD/STT/LLM/TTS session, publishes camera track, greets, runs vision on each user turn. | `npm start` → Chert/`chert-rooms` |
| `sightline/vision.mjs` | ~221 | Subscribes to caller video; JPEG encode; Gemini `describeFrame`; `logEvent` to Express. | `agent.mjs` |
| `sightline/chert-rooms.mjs` | ~127 | Own LiveKit **or** Chert room tokens from `~/.chert/rooms/argo.json`. | `agent.mjs` via `runAgent` |
| `sightline/greet.mjs` | ~38 | Waits for `chert_bridge_ready` in room metadata, then greets (avoids 10s silence hangup). | `agent.mjs` |
| `experiments/magnifier/` | — | Abandoned FaceTime video-text overlays (not wired). | Manual prototypes only |
| `sightline/thinking.mjs` | ~65 | Short “Looking.” fillers while Gemini runs; caps repeats to save ElevenLabs credits. | `agent.mjs` |
| `sightline/face.mjs` | ~33 | Original simple face (still in tree). **Not used** after avatar wire-up. | — (legacy) |

### Avatar

| File | Lines | What it does | Used by |
|------|------:|--------------|---------|
| `avatar/face.mjs` | ~213 | Odyssey warrior + forest; `drawFace` / WIDTH / HEIGHT / FPS. | `sightline/agent.mjs` |
| `avatar/face-vase.mjs` | ~184 | Alternate vase/hero style (same contract). | Optional swap |
| `avatar/render-preview.mjs` | ~45 | Writes `avatar/preview/*.png` for offline checks. | Manual `node` |

### Server (Mongo / dashboard API)

| File | Lines | What it does | Used by |
|------|------:|--------------|---------|
| `server/src/index.js` | ~73 | Express: `/health`, `/api/events`, `/api/sightings`, `/api/privacy/delete`. | Agent `logEvent`, future dashboard |
| `server/src/db.js` | ~59 | Mongo singleton; indexes; 7-day TTL on sightings/frames; wipe helper. | `index.js` |

### Config / docs (not runtime logic)

| File | Role |
|------|------|
| `plan.md` | HackUTA product plan + phase timeline |
| `README.md` | Repo overview |
| `sightline/.env.example` | Env template (models, keys placeholders) |
| `sightline/package.json` | Agent deps: LiveKit agents + ElevenLabs + Google plugins |
| `server/package.json` | Express, cors, mongodb |

---

## Public libraries we depend on (not our code)

**Agent:** `@livekit/agents`, `@livekit/rtc-node`, `@livekit/agents-plugin-elevenlabs`, `@livekit/agents-plugin-google` (+ unused openai plugin still listed).  
**Speech/models (remote APIs):** ElevenLabs Scribe + Flash TTS; Gemini vision + LLM.  
**Server:** `express`, `cors`, `mongodb`.  
**Bridge:** Chert FaceTime CLI (`@trychert/facetime`) outside this repo’s source tree.
