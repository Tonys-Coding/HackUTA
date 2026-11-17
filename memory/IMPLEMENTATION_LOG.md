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

---

## [2026-11-14] Revert on-call FaceTime text overlay

**Asked for:** Remove the on-screen magnifier; it did not work well and risked fighting the call. Brainstorm other ways to deliver large text without breaking audio.

**In short:** Outbound video is avatar-only again. Spoken OCR + follow-up memory stay. On-call bitmap text on the camera track is disconnected (`followup.mjs` keeps the look-again heuristic). Preferred next path for readable text: iMessage/image or a web link — off the FaceTime video/audio path.

### Files and folders
**Files added**
- `sightline/followup.mjs` — `wantsFreshLook` without magnifier coupling

**Files modified**
- `sightline/agent.mjs` — no `magnifier.show` / no video swap; Odyssey face only
- `sightline/package.json` / `.env.example` — drop magnifier check/env knobs

**Left in tree (unused)**
- `sightline/magnifier.mjs` and preview prototypes — not wired; safe to delete later

### Key decisions
- **Stop painting text on the LiveKit camera track**: Chose full disconnect. **Why:** FaceTime crop + bitmap layout made text unusable; swapping the video surface while TTS runs is fragile. **Why not keep iterating overlays:** User asked to revert and explore other channels. **Tradeoff:** no in-call large text until a non-video path ships.

---

## [2026-11-14] iMessage large-text image after OCR

**Asked for:** Implement alternative 1 — send high-contrast large text via iMessage so FaceTime audio/video stay untouched.

**In short:** After each successful read, Argo fire-and-forgets a portrait PNG through Chert `attachments` + `/api/v1/send`. The call keeps speaking; Messages gets a zoomable image. Requires `CHERT_SIGNING_SECRET` and `CHERT_IMESSAGE_TO`.

### Files and folders
**Files added**
- `sightline/large-text-image.mjs` — portrait white-on-black PNG renderer
- `sightline/imessage.mjs` — Chert upload + send helpers (`queueLargeTextImessage`)

**Files modified**
- `sightline/agent.mjs` — queue iMessage after first look and turn OCR (never awaits in TTS)
- `sightline/.env.example` / `.env.local` — document Chert messaging env vars

### How it works now
1. Gemini OCR succeeds → speak on FaceTime as before.
2. In parallel, render PNG → upload attachment → `/send` to `CHERT_IMESSAGE_TO`.
3. Failures only log; they do not interrupt speech.

### Watch out for
Shared-line recipient must be allowed to message the line. Missing env vars skip send with a warning.

---

## [2026-11-14] Fill framing avatar + pause large-text work

**Asked for:** Keep FaceTime video framing on **fill**; adjust avatar accordingly; omit large-text/iMessage implementation while researching low-vision UX.

**In short:** Avatar canvas is now **540×720 (3:4 portrait)** with the warrior scaled and centered so fill crop keeps face/shoulders. iMessage large-text queue removed from the live agent path (modules left in tree unused).

### Files modified
- `avatar/face.mjs` — portrait fill composition
- `sightline/agent.mjs` — no `queueLargeTextImessage`
- `.env.example` / `.env.local` — iMessage notes marked deferred

---

## [2026-11-15] Argos dog avatar + FaceTime fill framing

**Asked for:** Odyssey-themed outbound face that fills FaceTime (not a tiny letterboxed strip); keep Fill framing.

**In short:** Replaced the warrior/landscape experiments with Argos (loyal hound) on an Ithaca terrace at **540×1170** portrait. Scene is drawn through `VIEW` so Chert’s Fill crop still shows the dog large. Later raised `VIEW` from `0.52` → `0.78` when the dog looked shrunk again.

### Files and folders
**Files modified**
- `avatar/face.mjs` — Argos procedural RGBA; `WIDTH/HEIGHT` 540×1170; `VIEW` fill compensation; dog scale ~1.22×
- `sightline/agent.mjs` — imports `../avatar/face.mjs` for the LiveKit camera track

### How it works now
1. Agent publishes one unmuted audio + one camera track (same participant).
2. Paint loop calls `drawFace(tick, speaking)` into a `VideoSource`.
3. Fill framing crops edges; `VIEW` keeps Argos in the surviving center.

### Key decisions
- **Portrait fill canvas, not landscape 16:9**: Chose 9:19.5-ish phone shape. **Why:** landscape letterboxes into a strip on upright FaceTime. **Why not Fit mode only:** Fill is what Chert used in demos.
- **Procedural JS pixels, not Anam/Simli as default**: Chose local `drawFace`. **Why:** zero session token cost, works offline to the avatar SaaS. **Tradeoff:** less lip-sync realism; Anam/Simli remain optional env toggles (`ANAM_ENABLED` / `SIMLI_ENABLED`, default off).

### Watch out for
If Chert switches to **Fit**, raise `VIEW` toward `1`. Competing worktrees (`HackUTA-ImprovedAI-imessage`, `FasterResponse`, `improved-UI`) can drift — restart the worktree that actually holds port 8081.

---

## [2026-11-15] Large-text iMessage handouts + themes + turn routing

**Asked for:** Deliver readable large text without breaking FaceTime; let callers change contrast; send only when asked.

**In short:** After OCR, Argo keeps a per-call **digest**. “Text me that” (and similar) sends a high-contrast PNG through Chert shared-messages. Voice can switch themes (cream / yellow / white / dark). `turn-intent` / `followup` / `large-text-send` classify turns so we do not re-OCR every question or dump the whole menu.

### Files and folders
**Files added / heavily used**
- `sightline/imessage.mjs` — Chert upload + send (shared API key path)
- `sightline/large-text-image.mjs` — portrait PNG renderer
- `sightline/large-text-send.mjs` — digest / “text me that” matching
- `sightline/theme-pref.mjs` — per-phone theme store + phrase parsing
- `sightline/turn-intent.mjs` — help / stop / resend / fact-missing heuristics
- `sightline/session-memory.mjs` — per-call (and optional disk) read archive
- `sightline/imessage-inbox.mjs` — poll shared inbox; answer from last Mongo OCR
- `sightline/followup.mjs` — “look again” vs answer-from-memory

**Files modified**
- `sightline/agent.mjs` — theme → handout → vision/follow-up routing; iMessage never blocks TTS
- `sightline/.env.example` — `CHERT_API_KEY`, themes, inbox notes

### How it works now
1. OCR succeeds → speak on FaceTime; append to digest + call memory; `logEvent` to Express.
2. Follow-up about the same label → answer from saved text/pictures (lite LLM / `askAboutPictures`).
3. “Text me that” → PNG with current theme → Messages.
4. Optional `npm run imessage:inbox` answers texts after the call from last `vision.turn_described` event.

### Key decisions
- **iMessage PNG on request, not auto every OCR**: Chose opt-in. **Why:** shared-line rate limits + user control. **Why not always-on:** spam and failed attachment quotas.
- **Shared Messaging API over dedicated signing_secret when on trial**: Chose `CHERT_API_KEY` + project/line IDs. **Why:** shared trial credentials. **Tradeoff:** PNG attachments can be restricted on shared lines.

### Watch out for
Missing `CHERT_*` env skips send with a log. Inbox is a **separate** process from `npm start`. Shared allocation expiry kills messaging and FaceTime until `chert onboard`.

---

## [2026-11-15] Landing page brand: Argo AI

**Asked for:** Title → **Argo AI**; replace FaceTime line label “Silas Thorne” with **Argo**.

**In short:** GitHub Pages site under `docs/` updated (`<title>` / `og:title` → Argo AI; `LINE_NAME` → Argo). Chert console may still show the old line name until renamed there.

### Files modified
- `docs/index.html`, `docs/site.js`

### Watch out for
Pages deploys from `main`; local `magnifier` edits need merge/push to go live.

---

## [2026-11-15] Cost-efficient live models (confirmed stack)

**Asked for:** Reliable OCR + cheap chat/TTS after free-tier 429s.

**In short:** Paid Gemini split stays the production default; ElevenLabs Flash TTS; Scribe realtime STT; Silero VAD. Documented in env and agent defaults.

| Role | Model |
|------|--------|
| VAD | `silero` |
| STT | `scribe_v2_realtime` |
| Vision OCR | `gemini-3.6-flash` |
| Chat / follow-ups | `gemini-3.5-flash-lite` |
| TTS | `eleven_flash_v2_5` |

### Key decisions
- **Split vision vs chat**: OCR accuracy vs “Okay”/short reply cost. **Why not Pro:** live-call latency/cost.
- **Disable Gemini thinking budget on vision**: Prevents truncation of menu text.

### Watch out for
OpenAI Realtime remains fallback-only. Job IPC crashes (`Channel closed`) still require a clean agent restart.

---

## [2026-11-16] Ops: slot expiry + shared_allocation_inactive

**Asked for:** (ops) Keep FaceTime answering after overnight / hour slots.

**In short:** `chert dev --minutes 60` stops at slot end. Overnight, Chert lost heartbeat; later Argo was SIGKILL’d. Reconnect returned `shared_allocation_inactive` — shared line allocation expired. Express on `:8787` is independent and was restarted often for logging/dashboard paths.

### How it works now
1. Keep Express + `npm start` + `chert dev` as three processes.
2. When slot ends or allocation dies, renew `chert dev` / run `chert onboard --status`.
3. Only one worktree should own agent name `argo` on the LiveKit project.

### Watch out for
Multiple HackUTA worktrees racing on port 8081 cause “calls keep failing” even when one terminal looks warm.

---

## [2026-11-15] Argos dog avatar + FaceTime fill framing

**Asked for:** Odyssey-themed outbound face that fills FaceTime (not a tiny letterboxed strip); keep Fill framing.

**In short:** Replaced the warrior/landscape experiments with Argos (loyal hound) on an Ithaca terrace at **540×1170** portrait. Scene is drawn through `VIEW` so Chert’s Fill crop still shows the dog large. Later raised `VIEW` from `0.52` → `0.78` when the dog looked shrunk again.

### Files and folders
**Files modified**
- `avatar/face.mjs` — Argos procedural RGBA; `WIDTH/HEIGHT` 540×1170; `VIEW` fill compensation; dog scale ~1.22×
- `sightline/agent.mjs` — imports `../avatar/face.mjs` for the LiveKit camera track

### How it works now
1. Agent publishes one unmuted audio + one camera track (same participant).
2. Paint loop calls `drawFace(tick, speaking)` into a `VideoSource`.
3. Fill framing crops edges; `VIEW` keeps Argos in the surviving center.

### Key decisions
- **Portrait fill canvas, not landscape 16:9**: Chose 9:19.5-ish phone shape. **Why:** landscape letterboxes into a strip on upright FaceTime. **Why not Fit mode only:** Fill is what Chert used in demos.
- **Procedural JS pixels, not Anam/Simli as default**: Chose local `drawFace`. **Why:** zero session token cost, works offline to the avatar SaaS. **Tradeoff:** less lip-sync realism; Anam/Simli remain optional env toggles (`ANAM_ENABLED` / `SIMLI_ENABLED`, default off).

### Watch out for
If Chert switches to **Fit**, raise `VIEW` toward `1`. Competing worktrees (`HackUTA-ImprovedAI-imessage`, `FasterResponse`, `improved-UI`) can drift — restart the worktree that actually holds port 8081.

---

## [2026-11-15] Large-text iMessage handouts + themes + turn routing

**Asked for:** Deliver readable large text without breaking FaceTime; let callers change contrast; send only when asked.

**In short:** After OCR, Argo keeps a per-call **digest**. “Text me that” (and similar) sends a high-contrast PNG through Chert shared-messages. Voice can switch themes (cream / yellow / white / dark). `turn-intent` / `followup` / `large-text-send` classify turns so we do not re-OCR every question or dump the whole menu.

### Files and folders
**Files added / heavily used**
- `sightline/imessage.mjs` — Chert upload + send (shared API key path)
- `sightline/large-text-image.mjs` — portrait PNG renderer
- `sightline/large-text-send.mjs` — digest / “text me that” matching
- `sightline/theme-pref.mjs` — per-phone theme store + phrase parsing
- `sightline/turn-intent.mjs` — help / stop / resend / fact-missing heuristics
- `sightline/session-memory.mjs` — per-call (and optional disk) read archive
- `sightline/imessage-inbox.mjs` — poll shared inbox; answer from last Mongo OCR
- `sightline/followup.mjs` — “look again” vs answer-from-memory

**Files modified**
- `sightline/agent.mjs` — theme → handout → vision/follow-up routing; iMessage never blocks TTS
- `sightline/.env.example` — `CHERT_API_KEY`, themes, inbox notes

### How it works now
1. OCR succeeds → speak on FaceTime; append to digest + call memory; `logEvent` to Express.
2. Follow-up about the same label → answer from saved text/pictures (lite LLM / `askAboutPictures`).
3. “Text me that” → PNG with current theme → Messages.
4. Optional `npm run imessage:inbox` answers texts after the call from last `vision.turn_described` event.

### Key decisions
- **iMessage PNG on request, not auto every OCR**: Chose opt-in. **Why:** shared-line rate limits + user control. **Why not always-on:** spam and failed attachment quotas.
- **Shared Messaging API over dedicated signing_secret when on trial**: Chose `CHERT_API_KEY` + project/line IDs. **Why:** shared trial credentials. **Tradeoff:** PNG attachments can be restricted on shared lines.

### Watch out for
Missing `CHERT_*` env skips send with a log. Inbox is a **separate** process from `npm start`. Shared allocation expiry kills messaging and FaceTime until `chert onboard`.

---

## [2026-11-15] Landing page brand: Argo AI

**Asked for:** Title → **Argo AI**; replace FaceTime line label “Silas Thorne” with **Argo**.

**In short:** GitHub Pages site under `docs/` updated (`<title>` / `og:title` → Argo AI; `LINE_NAME` → Argo). Chert console may still show the old line name until renamed there.

### Files modified
- `docs/index.html`, `docs/site.js`

### Watch out for
Pages deploys from `main`; local `magnifier` edits need merge/push to go live.

---

## [2026-11-15] Cost-efficient live models (confirmed stack)

**Asked for:** Reliable OCR + cheap chat/TTS after free-tier 429s.

**In short:** Paid Gemini split stays the production default; ElevenLabs Flash TTS; Scribe realtime STT; Silero VAD. Documented in env and agent defaults.

| Role | Model |
|------|--------|
| VAD | `silero` |
| STT | `scribe_v2_realtime` |
| Vision OCR | `gemini-3.6-flash` |
| Chat / follow-ups | `gemini-3.5-flash-lite` |
| TTS | `eleven_flash_v2_5` |

### Key decisions
- **Split vision vs chat**: OCR accuracy vs “Okay”/short reply cost. **Why not Pro:** live-call latency/cost.
- **Disable Gemini thinking budget on vision**: Prevents truncation of menu text.

### Watch out for
OpenAI Realtime remains fallback-only. Job IPC crashes (`Channel closed`) still require a clean agent restart.

---

## [2026-11-16] Ops: slot expiry + shared_allocation_inactive

**Asked for:** (ops) Keep FaceTime answering after overnight / hour slots.

**In short:** `chert dev --minutes 60` stops at slot end. Overnight, Chert lost heartbeat; later Argo was SIGKILL’d. Reconnect returned `shared_allocation_inactive` — shared line allocation expired. Express on `:8787` is independent and was restarted often for logging/dashboard paths.

### How it works now
1. Keep Express + `npm start` + `chert dev` as three processes.
2. When slot ends or allocation dies, renew `chert dev` / run `chert onboard --status`.
3. Only one worktree should own agent name `argo` on the LiveKit project.

### Watch out for
Multiple HackUTA worktrees racing on port 8081 cause “calls keep failing” even when one terminal looks warm.
