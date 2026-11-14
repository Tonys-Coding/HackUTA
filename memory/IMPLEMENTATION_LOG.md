# Argo implementation log

Running defense notes (whiteboard-test). Newest entries at the bottom. Do not rewrite older entries.

---

## [2026-11-14] Phase 1 walking skeleton — see + speak

**Asked for:** FaceTime agent that sees the caller’s camera, uses Gemini to describe/read it, and speaks back (HackUTA Phase 1).

**In short:** Argo joins a Chert/LiveKit room, greets when FaceTime is bridged, grabs JPEG frames from the caller, asks Gemini what is on screen, and speaks the answer through ElevenLabs. Events are posted to a small Express + Mongo API so we can prove what happened.

### Files and folders
**Folders**
- Added `sightline/` — LiveKit agent process (Chert starter shape + our vision/voice wiring)
- Added `server/` — Express API + Mongo helpers for event logging

**Files added**
- `sightline/agent.mjs` — session (Silero VAD, ElevenLabs STT/TTS, Gemini LLM), video publish loop, turn handler
- `sightline/vision.mjs` — subscribe to caller video, `describeFrame` via Gemini REST, `logEvent`
- `sightline/chert-rooms.mjs` — own LiveKit project **or** Chert room token path
- `sightline/greet.mjs` — greet only after `chert_bridge_ready` (Mac kills silent calls after 10s)
- `sightline/face.mjs` — original simple RGBA face
- `server/src/index.js` — `/api/events`, `/api/sightings`, privacy delete stub
- `server/src/db.js` — Mongo connect, indexes, 7-day TTL

**Files modified**
- (starter templates adapted into the files above)

### How it works now
1. `chert dev --agent argo` warms a waiting room; `npm start` registers the worker.
2. Caller FaceTimes the line; Chert bridges into LiveKit; `greet.mjs` fires on `bridge_ready`.
3. `attachCallerVision` keeps the latest frame; first look + each user turn call `describeFrame`.
4. Gemini returns short speakable text; `session.say` / TTS plays it.
5. `logEvent` POSTs to `http://localhost:8787/api/events` (Mongo `events` collection).

### Key decisions
- **ElevenLabs STT + TTS, Gemini for brain/eyes**: Chose this stack. **Why:** confirmed in the grill/plan for voice quality + vision prize path. **Why not OpenAI Realtime alone:** plan kept Gemini in the loop for vision/Mongo prizes. **Tradeoff:** more moving parts and two vendor bills.
- **Greet on bridge_ready, not participant join**: Chose metadata signal. **Why:** Chert docs — join is too early; silence gets the call hung up. **Tradeoff:** depends on Chert metadata shape.
- **Vision as Gemini REST JPEG, not LiveKit ImageContent in the LLM turn**: Chose describe-then-say. **Why:** ImageContent path hung/failed in practice (inferred from debugging). **Tradeoff:** we manually speak OCR so the LLM must be told not to re-read.

### If someone challenges this
- *Is this just a LiveKit demo?* The product logic is the OCR prompt, low-vision wording, Chert timing, and Mongo trail — LiveKit is the transport.
- *Why Mongo already?* Prize path + judging dashboard later; events already prove the call saw a menu.

### Watch out for
Free-tier Gemini daily caps (we hit 429 on `gemini-2.5-flash`). Express must be up or logging silently fails. Secrets only in `.env.local`.

---

## [2026-11-14] Fix silence / truncation / quota; cost-efficient models

**Asked for:** Stop cutoff answers and “trouble reading then no replies”; use stronger models once billing exists; keep ElevenLabs cheap.

**In short:** Truncation came from Gemini “thinking” eating `maxOutputTokens`. Silence after failure was free-tier **429**. We raised output budget, set `thinkingBudget: 0`, moved to paid split (`gemini-3.6-flash` vision + `gemini-3.5-flash-lite` chat), switched TTS to `eleven_flash_v2_5`, and capped thinking fillers.

### Files and folders
**Files added**
- `sightline/thinking.mjs` — “Looking.” fillers while vision runs (max 2, longer interval)

**Files modified**
- `sightline/vision.mjs` — stronger OCR prompt, `maxOutputTokens: 512`, `thinkingConfig.thinkingBudget: 0`, default vision model `gemini-3.6-flash`
- `sightline/agent.mjs` — await playout helpers, speak OCR immediately, LLM told “Okay.” only; LLM default `gemini-3.5-flash-lite`; TTS Flash
- `sightline/.env.example` / `.env.local` — `GEMINI_VISION_MODEL`, `GEMINI_LLM_MODEL`, `ELEVEN_TTS_MODEL`

### How it works now
1. User asks what’s on camera → filler may play once.
2. `describeFrame` calls Gemini vision with thinking disabled so OCR text isn’t truncated.
3. Agent speaks the full description; LLM is forced to “Okay.” so it doesn’t talk over the read.
4. Chat turns use flash-lite (cheap); vision uses 3.6-flash (accuracy).

### Key decisions
- **Split vision vs chat models**: Chose 3.6-flash + 3.5-flash-lite. **Why:** OCR needs the stronger multimodal model; spoken “Okay” does not. **Why not Pro:** slower and costlier for menus on a live call. **Tradeoff:** two model IDs to keep in env.
- **Flash TTS over Turbo**: Same cheap tier, lower latency per ElevenLabs docs. **Tradeoff:** still pay Scribe realtime per call minute.
- **Fewer fillers**: Saves ElevenLabs characters and stops fillers cutting off answers.

### If someone challenges this
- *Why not one model for everything?* Chat would pay vision prices and latency for every “Okay.”
- *Did $5 billing matter?* Yes — free tier was ~20 RPD on 2.5-flash; paid is what made the Rimberio menu read work.

### Watch out for
Exact spend is in AI Studio Billing (no public spend API). Successful Rimberio call estimated **≪ $0.01** Gemini. Log `thinkingBudget` carefully — some lite models reject that field on generateContent.

---

## [2026-11-14] Odyssey avatar on the outbound FaceTime video

**Asked for:** Pull `main` avatar update and show it on Argo’s camera track.

**In short:** `main` added `avatar/face.mjs` (warrior in fog/forest). Agent now imports that instead of `sightline/face.mjs`, so callers see the Odyssey face while Argo speaks.

### Files and folders
**Folders**
- Added `avatar/` — Odyssey face implementations + PNG previews

**Files added** (from PR `#1`)
- `avatar/face.mjs` — active face
- `avatar/face-vase.mjs` — alternate style
- `avatar/render-preview.mjs` + `avatar/preview/*.png`

**Files modified**
- `sightline/agent.mjs` — `import { drawFace, ... } from '../avatar/face.mjs'`

### How it works now
1. Agent publishes a LiveKit camera track from a `VideoSource`.
2. Interval calls `drawFace(tick, speaking)` where `speaking` tracks agent state.
3. Frames are 640×360 RGBA at 15 FPS — same contract as the Chert starter.

### Key decisions
- **Import from `avatar/` rather than copy into `sightline/face.mjs`**: One canonical art file. **Why not replace in place only:** PR landed a separate folder; import keeps git history clear. **Tradeoff:** `npm run check` still syntax-checks old `sightline/face.mjs`.

### If someone challenges this
- *Is the avatar AI-generated video?* No — pure JS pixel drawing, no external avatar SaaS.
- *Does it block OCR?* No — outbound face is independent of inbound caller frames used for Gemini.

### Watch out for
Phase 2 magnifier may need to **swap** this track to large text temporarily; plan for a mode flag on the paint loop.

---

## [2026-11-14] Phase 2 magnifier — large text on FaceTime video

**Asked for:** Phase 2 magnifier MVP on branch `magnifier`: speak the OCR and show large high-contrast text; follow-ups without re-OCR when possible.

**In short:** After each successful read, Argo keeps `lastReadText` and swaps the outbound camera from the Odyssey avatar to a white-on-black large-text frame for ~22s. Follow-up questions about that text go to the lite LLM with the stored OCR; "read this / look again" triggers a new Gemini vision call.

### Files and folders
**Files added**
- `sightline/magnifier.mjs` — bitmap large-text renderer + `wantsFreshLook`; same 640×360 RGBA contract as the avatar
- `sightline/thinking.mjs` — short vision fillers (carried from Phase 1 fixes onto this branch)

**Files modified**
- `sightline/agent.mjs` — paint loop avatar↔magnifier; session `lastReadRef`; follow-up path; model/TTS cost defaults
- `sightline/vision.mjs` — OCR prompt + `thinkingBudget: 0` + `gemini-3.6-flash` default
- `sightline/package.json` / `.env.example` — check script + magnifier env knobs

### How it works now
1. OCR succeeds → speak text, `magnifier.show(text)`, store `lastReadRef`.
2. Paint loop draws magnifier frames while `isShowing()`, else Odyssey `drawFace`.
3. Caller asks "any under $5?" → no new vision; LLM answers from stored text; magnifier stays up.
4. Caller says "read this" → new frame + Gemini vision again.

### Key decisions
- **Custom video track for large text (ladder step 1)**: Chose swapping the existing agent camera track. **Why:** plan prefers outbound video when allowed; we already publish a face track. **Why not iMessage image first:** slower demo path; keep as fallback later. **Tradeoff:** FaceTime UI chrome may crop edges; text uses padding.
- **Tiny bitmap font, no canvas deps**: Chose hand-drawn 5×7 glyphs scaled ×5. **Why:** zero native deps on the agent box. **Tradeoff:** limited character set; unknown chars become `?`.

### If someone challenges this
- *Is this just the avatar again?* No — after a read the caller should see huge white-on-black words, then the warrior returns when the timer ends.
- *Why not re-OCR every question?* Saves Gemini cost/latency and matches "what's the total?" against the menu already read.

### Watch out for
Lowercase maps to uppercase glyphs. Very long menus scroll slowly. iMessage image fallback not built yet. Theme via `MAGNIFIER_THEME`.
