# Argo AI — HackUTA × Chert plan (updated)

> Original grill plan from HackUTA 2026. **Updated 2026-11-17** to match what shipped.
> Branding: **Argo AI** (product) / agent name `argo` / persona **Argos** (Odysseus’s dog).
> Full handoff: [`handoff.md`](./handoff.md). Defense log: [`memory/IMPLEMENTATION_LOG.md`](./memory/IMPLEMENTATION_LOG.md).

## 1. Context

- **Event:** HackUTA 2026 (UT Arlington, Odyssey theme). Chert track: “Best Use of FaceTime”.
- **Prizes targeted:** Main Track + Chert + Gemini + MongoDB (ElevenLabs as voice quality, not primary prize).
- **Build window:** ~24h hackathon + post-hack polish.
- **Demo format:** science fair, ~3 min + 2 min Q&A.
- **Chert:** Shared FaceTime/iMessage line. Agent must stay warm via `chert dev --agent argo` (slots expire ~hourly; shared allocation can expire overnight).

## 2. Concept (unchanged)

FaceTime + iMessage helper for **low-vision** users (not only fully blind):

1. **Talking magnifier** — Point the phone at text; Argo reads aloud. Large high-contrast text is delivered via **iMessage PNG** when asked (not painted onto FaceTime video).
2. **Keep the words** — Follow-ups on this call (“how much sodium?”) answer from saved reads. Optional post-call iMessage inbox answers from last OCR.

**Why FaceTime:** no install, camera is the point, trusted UX. **Why iMessage for large text:** FaceTime fill-crop made on-call text overlays unusable.

**We deliberately do not center on walking guidance.**

## 3. What shipped vs deferred

| Flow | Plan priority | Status |
|------|---------------|--------|
| Magnify and read (FaceTime voice + Gemini OCR) | MVP | **Shipped** |
| Follow-ups from saved text / pictures this call | MVP | **Shipped** |
| Large-text handout via iMessage PNG + contrast themes | MVP | **Shipped** (on ask: “text me that”) |
| Theme voice control (“use cream / yellow / dark”) | Polish | **Shipped** |
| Post-call iMessage Q&A from last OCR (`imessage:inbox`) | MVP-ish | **Shipped** (separate process) |
| Odyssey avatar on outbound video (Argos dog, fill framing) | Polish | **Shipped** |
| Landing page (GitHub Pages `docs/`) | Polish | **Shipped** (`Argo AI` title) |
| Mongo event logging + 7-day TTL | MVP | **Shipped** (Express `:8787`) |
| Room scan / find-my-things + vector search | MVP | **Deferred** |
| Live “where is it” guidance | Stretch | **Deferred** |
| React judging dashboard | Phase 4 | **Deferred** (API stubs exist) |
| “delete my data” iMessage wipe | Privacy | **Stubbed** on API; not fully wired |
| On-call FaceTime large-text video overlay | Ladder step 1 | **Tried → reverted** |

## 4. Architecture (as built)

```
iPhone --FaceTime Video--> Chert Mac --LiveKit--> agent "argo" (sightline/)
                              |                      |
                              |         Silero VAD → ElevenLabs Scribe STT
                              |         Gemini 3.6 Flash (vision OCR)
                              |         Gemini 3.5 Flash-Lite (chat / follow-ups)
                              |         ElevenLabs Flash TTS
                              |         Outbound camera: Argos avatar (540×1170)
                              |
                         iMessage <--- Chert shared-messages API
                              |         Large-text PNG (themes) on request
                              |         Optional inbox poller for text Q&A
                              v
                    Express :8787 → MongoDB Atlas (events, 7-day TTL)
```

### Magnifier delivery ladder (final)

1. ~~Paint large text on FaceTime video track~~ — failed under Fill crop.
2. **iMessage native PNG attachment** — current path.
3. Voice-only if messaging env/allocation is down.

### Voice (confirmed)

ElevenLabs STT (`scribe_v2_realtime`) → Gemini LLM → ElevenLabs TTS (`eleven_flash_v2_5`). Not OpenAI Realtime as primary.

## 5. Runbook (ops)

```bash
# A — Mongo/event API
cd server && npm start          # http://localhost:8787

# B — agent worker
cd sightline && npm start       # registers as AGENT_NAME=argo on LiveKit

# C — hold the FaceTime line (renew when slot ends)
cd sightline && npx @trychert/facetime@0.1.0-beta.21 \
  dev --agent argo --json --minutes 60 --force --takeover

# Optional — post-call text Q&A
cd sightline && npm run imessage:inbox
```

**Known ops failures**

- `agent_did_not_join` / `agent_not_warm` → agent not registered or crashed; restart B then C.
- `shared_allocation_inactive` → Chert shared line expired; run `chert onboard` / status and get a new allocation.
- Slot ends hourly → C must be renewed or FaceTime declines.
- Express down → vision still works; Mongo logging / some inbox features fail silently.

## 6. Demo script (current product)

1. Text `join BL2LTM` to the line (iMessage) if required by shared trial.
2. FaceTime Video Argo. Wait for greeting.
3. Hold a menu/label steady. “Read this.”
4. Ask a follow-up (“any under five dollars?” / “how much sodium?”) without re-aiming.
5. “Text me that” → check Messages for high-contrast PNG. Optionally “use yellow” / cream / dark.
6. (Optional) After hangup, text the line a follow-up if inbox is running.
7. Show landing page + Mongo/events if judges want proof.

**Backup:** screen recording if Wi-Fi / shared line / allocation fails.

## 7. Accessibility and safety

- Short speakable answers; English even if label/caller is another language (translate).
- High-contrast PNG themes (~15:1–21:1): dark-on-cream, black-on-yellow, black-on-white, yellow-on-black, white-on-black.
- Medication / labels: **read only**, no advice; say when unsure.
- Privacy: frames/events TTL **7 days**; do not claim an object is still where it was last seen (when memory ships).

## 8. Risks (updated)

| Risk | Mitigation |
|------|------------|
| Shared line / allocation expiry | Book slots; `chert onboard` when inactive; offline sample frames |
| Agent job-process crashes | Keep one clean worker; restart B+C together |
| Gemini free-tier 429 | Paid Gemini; split vision vs lite chat |
| FaceTime Fill crops avatar | Portrait 540×1170 + `VIEW≈0.78` fill compensation |
| On-call text unreadable | iMessage PNG instead of video overlay |
| Scope creep | Find-my-things / dashboard deferred |

## 9. Decisions (locked)

- Product: low-vision **talking magnifier** first; find-my-things later.
- Stack: TypeScript, Gemini vision+LLM, ElevenLabs STT/TTS, MongoDB Atlas, Chert+LiveKit.
- Large text: **iMessage PNG on request**, not FaceTime video paint.
- Avatar: procedural **Argos** dog (Odyssey), not Anam/Simli for the live path (optional toggles exist, off by default).
- Models: `gemini-3.6-flash` vision, `gemini-3.5-flash-lite` chat, `eleven_flash_v2_5` TTS, `scribe_v2_realtime` STT, Silero VAD.
- Landing brand title: **Argo AI**; FaceTime line display name preference: **Argo**.

## 10. Open / next

1. Renew Chert shared allocation when `shared_allocation_inactive`.
2. Ship find-my-things (room scan + Atlas vector search) if continuing post-hack.
3. Wire “delete my data” end-to-end.
4. Minimal React dashboard on top of `/api/events`.
5. Rename Chert console line from any leftover “Silas Thorne” to Argo if staff/UI allows.
