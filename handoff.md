# Argo AI — project handoff

**Product:** Argo AI (FaceTime + iMessage helper for low vision)  
**Agent id:** `argo`  
**Persona / avatar:** Argos — Odysseus’s dog (Odyssey / HackUTA theme)  
**Repo:** [Tonys-Coding/HackUTA](https://github.com/Tonys-Coding/HackUTA)  
**Landing:** `docs/` → GitHub Pages (`Argo AI`)  
**Updated:** 2026-11-17  

Related docs: [`plan.md`](./plan.md) · [`memory/IMPLEMENTATION_LOG.md`](./memory/IMPLEMENTATION_LOG.md) · [`memory/FILES.md`](./memory/FILES.md) · [`memory/OWNERSHIP.md`](./memory/OWNERSHIP.md) · [`README.md`](./README.md)

---

## 1. Mission

Help people with **low vision** (and caregivers) read the physical world through tools they already trust:

- **See** — FaceTime camera points at a menu, label, letter, or screen.
- **Hear** — Argo speaks a short, careful answer.
- **Keep** — On request, Argo texts a **large, high-contrast** image to Messages so the words stay after the phone is put down.

We are **not** building indoor walking guidance. We are building a **talking magnifier** with memory of what was just read.

---

## 2. Pitch (30–60 seconds)

> Most phone magnifiers make text bigger for a second — then you put the phone down and the words disappear. **Argo AI** stays on FaceTime. You show a label or menu; Argo reads it out loud. Ask follow-ups like “any under five dollars?” without starting over. Say “text me that” and you get a high-contrast handout in iMessage you can pinch-zoom and keep. Named after Argos, the dog who waited — a steady companion on the call. Built on Chert FaceTime + Gemini vision for HackUTA.

**Tagline (landing):** Show it. Ask. Keep the words.

---

## 3. Problem & users

| | |
|--|--|
| **Users** | People with low vision; caregivers helping with mail, meds packaging, menus |
| **Pain** | Camera magnifiers are fleeting; screen readers don’t help printed/physical text; new apps = friction |
| **Why FaceTime** | No install, camera-native, accessible, iMessage for persistence |
| **Safety** | Read labels only — never give medical advice; say when unsure |

---

## 4. Features (shipped)

### FaceTime
- Join Chert waiting room as agent **`argo`**; greet within 10s of `bridge_ready`.
- Publish **one** audio track + **one** camera track (Argos avatar).
- Hear the caller (ElevenLabs Scribe realtime + Silero VAD).
- OCR / describe the latest caller frame with **Gemini 3.6 Flash**.
- Short spoken answers via **ElevenLabs Flash TTS**.
- Follow-ups this call from saved OCR / picture history (no re-look unless “read this” / “look again”).
- Voice themes for handouts: cream, yellow, white, dark (and related phrases).
- “Text me that” / digest send of what was read.
- Stop / help / resend-style intents (see `turn-intent.mjs` / `followup.mjs`).

### iMessage
- Native **PNG** large-text attachments (not hosted links by default).
- Contrast themes aimed at ~15:1–21:1.
- Optional **`npm run imessage:inbox`** poller: text the shared line after a call about the last FaceTime OCR in Mongo.

### Backend / proof
- Express API on **`:8787`**: `/api/events`, `/api/sightings`, privacy delete stub.
- MongoDB Atlas with **7-day TTL** on relevant collections.
- Event types such as `vision.turn_described`, theme switches, iMessage queue results.

### Web
- Static landing in **`docs/`** (brand **Argo AI**, invite `join BL2LTM`, FaceTime CTA).

### Explicitly not shipped (yet)
- Room scan / “where are my keys?” vector memory.
- Live pan guidance.
- Full React judging dashboard.
- End-to-end “delete my data” from iMessage.
- Always-on Anam/Simli talking-head (env exists; default **off**).

---

## 5. Tech stack

| Layer | Choice |
|-------|--------|
| FaceTime bridge | **Chert** (`@trychert/facetime`) → LiveKit room |
| Agent runtime | **LiveKit Agents** Node (`@livekit/agents`, `rtc-node`) |
| Language | **JavaScript (ESM)** — `sightline/*.mjs`, `avatar/*.mjs` |
| VAD | LiveKit inference **Silero** |
| STT | **ElevenLabs** `scribe_v2_realtime` (+ server VAD) |
| Vision OCR | **Gemini** `gemini-3.6-flash` (REST JPEG) |
| LLM chat | **Gemini** `gemini-3.5-flash-lite` |
| TTS | **ElevenLabs** `eleven_flash_v2_5` |
| Outbound video | Procedural **Argos** RGBA frames `540×1170` |
| Messaging | Chert **shared-messages** API (+ optional dedicated signing secret) |
| API / DB | **Express 5** + **MongoDB Atlas** |
| Landing | Static HTML/CSS/JS in `docs/` |
| Optional (off) | Anam / Simli avatars; OpenAI Realtime fallback key |

**Worktrees note:** Feature-complete agent often runs from sibling folders (`HackUTA-ImprovedAI-imessage`, `HackUTA-FasterResponse`). Only **one** process may register as `argo` on the LiveKit project.

---

## 6. Architecture

```
Caller iPhone
    │ FaceTime Video
    ▼
Chert Mac (shared/dedicated line)
    │ LiveKit bridge (chert-bridge-<callId>)
    ▼
argo worker (sightline/agent.mjs)
    ├─ greetOnBridgeReady → session.say
    ├─ attachCallerVision → latest VideoFrame
    ├─ describeFrame / askAboutPictures → Gemini
    ├─ STT/TTS session → ElevenLabs
    ├─ drawFace loop → LiveKit camera track
    ├─ queueLargeTextImessage → Chert → Messages
    └─ logEvent → http://localhost:8787/api/events → Mongo

Optional: imessage-inbox.mjs polls shared inbox → answers from last OCR
```

**Secrets:** `.env.local` / `sightline/.env.local` only — never commit. Template: `sightline/.env.example`.

---

## 7. Decisions (why this way)

| Decision | Chose | Why | Why not |
|----------|-------|-----|---------|
| Voice path | ElevenLabs + Gemini | Voice quality + Gemini prize path | OpenAI Realtime alone (no Gemini in loop) |
| Vision delivery | REST JPEG → speak | ImageContent-in-LLM hung in practice | Multimodal turn as sole path |
| Models | 3.6-flash vision + 3.5-flash-lite chat | OCR needs strength; chat is short | One Pro model (cost/latency) |
| TTS | `eleven_flash_v2_5` | Cheap tier, lower latency | Turbo / higher quality (cost) |
| Large text | iMessage PNG on ask | FaceTime Fill crop killed overlays | Paint text on video track |
| Avatar | Procedural Argos JS | Free, offline, Odyssey theme | Anam/Simli default (cost/complexity) |
| Fill framing | Portrait + `VIEW≈0.78` | Dog readable under Fill | Landscape / VIEW 0.52 (looked tiny) |
| Greet timing | `chert_bridge_ready` | Avoid 10s silence hangup | Greet on participant join |
| Memory scope | This-call first | Reliable demo; cheaper | Full room vector search in 24h |
| Handouts | Opt-in “text me that” | Rate limits + user control | Auto-send every OCR |

---

## 8. Considerations

### Accessibility
- Short spoken turns; no markdown lists in TTS.
- High-contrast themes; large type; pinch-zoom in Messages.
- Prefer English speech; translate foreign print when reading.

### Safety
- Medication / allergen / dosage: **read the label**, do not advise.
- Say when the image is blurry or unsure.
- Never invent “I already texted you” without a send.

### Privacy
- Prefer 7-day retention on stored frames/events.
- Do not claim an object is still where it was last seen (when find-my-things exists).
- Privacy delete API stubbed — wire carefully before demo claims.

### Ops / reliability
- Three processes: **server**, **agent**, **chert dev**.
- Chert **slots** (~60 min) and **shared allocations** expire → FaceTime declines until renewed.
- Agent job crashes (`Channel closed`) need a full worker restart.
- DNS / laptop sleep causes `transport_failure` and `agent_not_warm`.
- Express restart does **not** fix FaceTime; it only fixes Mongo/logging/inbox inputs.

### Cost
- Gemini paid tier required after free 429s.
- Scribe realtime meters call minutes; cap filler phrases.
- Vision vs lite chat split keeps follow-ups cheap.

---

## 9. How to run (handoff checklist)

1. Fill `sightline/.env.local` and root `.env.local` (LiveKit trio, Gemini, ElevenLabs, Mongo, Chert messaging).
2. `cd server && npm install && npm start` → confirm `http://localhost:8787`.
3. `cd sightline && npm install && npm start` → log shows `registered worker` / `agentName: argo`.
4. `npx @trychert/facetime@0.1.0-beta.21 doctor --agent argo`.
5. `npx @trychert/facetime@0.1.0-beta.21 dev --agent argo --minutes 60 --force --takeover` → wait for `agent_warm`.
6. FaceTime Video the line. If declined: check warm state, allocation, and that only one `argo` worker exists.
7. Optional: `npm run imessage:inbox` for post-call text.

**If `shared_allocation_inactive`:** run Chert onboard/status and request a new shared allocation before demos.

---

## 10. Repo map (crucial)

| Path | Role |
|------|------|
| `sightline/agent.mjs` | Session, routing, publish video, call loop |
| `sightline/vision.mjs` | Caller frames, Gemini OCR / picture Q&A, `logEvent` |
| `sightline/imessage.mjs` | Send large-text PNG |
| `sightline/large-text-*.mjs` | PNG render + digest matching |
| `sightline/theme-pref.mjs` | Contrast themes |
| `sightline/turn-intent.mjs` / `followup.mjs` | Intent heuristics |
| `sightline/session-memory.mjs` | Per-call read archive |
| `sightline/imessage-inbox.mjs` | Post-call text loop |
| `sightline/greet.mjs` / `chert-rooms.mjs` | Bridge timing / room connect |
| `avatar/face.mjs` | Argos outbound frames |
| `server/src/*` | Express + Mongo |
| `docs/*` | Landing page (+ YouTube demo) |
| `experiments/magnifier/` | Unused FaceTime video-text overlays |
| `plan.md` | Living product plan |
| `handoff.md` | This document |
| `memory/*` | Defense log / file map / ownership |

---

## 11. Demo script

1. Show landing → invite + FaceTime number.
2. Call → Argos appears → greeting.
3. Menu/label → “Read this.”
4. Follow-up without re-aiming.
5. “Text me that” → open Messages → show theme / contrast.
6. (Optional) Hang up → text a question if inbox is up.
7. Show Mongo/events or logs if judges ask “did Gemini really see it?”

**Success bar:** one clean live path — read + follow-up + iMessage handout.

---

## 12. Known issues / debt

- Chert shared allocation can go inactive overnight.
- Multiple local worktrees fighting for `argo` / port 8081.
- On-call video text overlay abandoned; don’t reintroduce without a new UX test on Fill.
- Find-my-things and dashboard still open from original plan.
- Landing `LINE_NAME` may say Argo while Chert console still shows an older line nickname.
- `npm run check` may still reference legacy `sightline/face.mjs`.

---

## 13. Glossary

| Term | Meaning |
|------|---------|
| **Argo AI** | Product / landing brand |
| **argo** | LiveKit / Chert `AGENT_NAME` |
| **Argos** | Dog avatar / Odyssey persona |
| **bridge_ready** | Chert signal that FaceTime media is up — greet now |
| **Fill** | Chert/FaceTime video framing that crops edges |
| **Digest** | Per-call list of texts eligible for “text me that” |
| **Warm** | Agent is in the waiting room and can answer |

---

## 14. Contacts / external consoles

- Chert: https://app.trychert.com/overview  
- Gemini / AI Studio billing  
- ElevenLabs usage  
- MongoDB Atlas cluster  
- LiveKit Cloud project matching `LIVEKIT_*` in env  

Keep API keys out of chat, git, and screenshots.
