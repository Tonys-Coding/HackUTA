# How much of this is “our code”?

Measured **2026-11-14** on this machine (JS/MJS only; lockfiles and docs excluded from the % below).

| Bucket | Lines (approx.) | Share |
|--------|----------------:|------:|
| First-party (`sightline/`, `avatar/`, `server/src/`) | 1,278 | **2.3%** |
| Installed deps (`*/node_modules` JS) | 54,658 | **97.7%** |

Disk: ~310 MB under `node_modules` vs a few hundred KB of our `.mjs`/`.js`.

### How to say this out loud

- **By lines on disk:** almost everything shipping in `node_modules` is public frameworks/libraries (~**98%**).
- **By product behavior:** the *ideas* are ours (low-vision read-aloud, OCR prompts, Chert greet timing, Odyssey avatar, Mongo event schema). The *engines* are LiveKit, ElevenLabs, Gemini, Express, MongoDB, Chert.

### What we did *not* invent

Realtime room/agent runtime, STT/TTS models, Gemini vision/LLM weights, HTTP framework, database driver, FaceTime bridge.

### What we *did* invent / customize

Prompting and turn logic in `vision.mjs` / `agent.mjs`, bridge-ready greeting, thinking fillers, Odyssey `drawFace`, Express event API + 7-day retention, model/cost choices in env.
