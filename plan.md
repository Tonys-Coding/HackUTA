# HackUTA x Chert: Talking Magnifier + "Find My Things" for Low-Vision Users

> Confirmed plan after grill-me interview. Build order follows Section 5.

## 1. Context

- **Event:** HackUTA 2026 (UT Arlington, Odyssey theme). Chert track: "Best Use of FaceTime".
- **Track prompt:** Chert puts AI agents in iMessage and FaceTime. Build one that's more useful when it can see.
- **Prizes (stackable):** Main Track + Chert ($400 for 1st; top 3 teams get guaranteed FDE/SWE intern interviews) + Gemini + MongoDB. Optional extras if cheap: Vultr (hosting), ElevenLabs.
- **Team:** 2 people (me and a partner). Work split is decided by us; not part of this plan.
- **My stack:** React, TypeScript, Express. Also Python, Java, C++.
- **Build window: 24 hours (confirmed).** Counted as H+0 to H+24. Exact clock times TBD — H+0 = when we start building.
- **Demo format:** science fair, 3 min presentation + 2 min Q&A.
- **Judging (Main Track):** Robustness, Odyssey theme, Creativity. Odyssey theming is deferred until after the core works.
- **Chert access:** Connected. Trial project `c7add437-4325-44ff-92ef-a9a859309c44`, line `+16504444331`, join code `join BL2LTM`. Connect prompt followed from https://app.trychert.com/skills.md.
- **Keys/accounts needed:** Gemini API key (have it), OpenAI API key (fallback), MongoDB Atlas free cluster, LiveKit Cloud account, Chert project access. Keep all keys in `.env.local`, never commit them.

## 2. Concept

A FaceTime/iMessage agent for **low-vision users** (not only fully blind users) with two halves:

1. **Talking magnifier.** The user points their phone at text (menu, label, letter, appliance dial). The agent reads it aloud **and** shows the text back **large, high-contrast, and reflowed**, because most low-vision users have usable vision and need things bigger, not just narrated.
2. **Find my things (visual memory over iMessage).** The user pans the camera around a room once. The agent indexes what it sees. Later the user texts "where are my keys / pills / cane?" and the agent replies with the last place it saw them, plus the frame.

**Why FaceTime:** no app to install, already accessible and trusted, the camera is the point, and iMessage afterward gives a persistent record and powers the memory.

### What Chert provides vs. what we build

| Chert provides | We build |
|---|---|
| FaceTime line bridged to a LiveKit room, caller video/audio tracks (opt-in), iMessage send/receive, webhooks | Low-vision-specific rendering: large high-contrast reflowed text, contrast themes |
| Agent-owned voice pipeline (we choose the model) | Safety behavior for labels and medication (read, don't advise; say when unsure) |
| Nothing for memory | Object memory: last-seen location, timestamp, frame, queried by text with Gemini embeddings + MongoDB |
| | Post-call summary design: short, VoiceOver-friendly texts |
| | Dashboard that shows judges what the agent saw and remembers |

**We deliberately do not center on walking guidance.**

### Target user
People with low vision, and their caregivers. Community interview skipped for this hackathon.

## 3. Core user flows

| # | Flow | What the agent does | Priority |
|---|------|---------------------|----------|
| 1 | **Magnify and read** | User shows text; agent speaks it and shows large high-contrast text. Answers follow-ups ("what's the total?", "any peanuts?") | MVP |
| 2 | **What am I holding?** | Identifies a product or medication box, reads expiry and dosage text (with safety wording) | MVP bonus |
| 3 | **Scan the room** | User pans once; agent indexes frames and says what it noticed | MVP |
| 4 | **Where is it? (text)** | User later iMessages "where are my keys?"; agent replies with last-seen location and the frame | MVP |
| 5 | **Text me the summary** | After a read call, agent iMessages a clean summary | MVP (cheap) |
| 6 | **Live "where is it" guidance** | Real-time pan guidance | Stretch, unreliable |

### Stretch ideas (only if MVP is solid)
- Caregiver view with consent; saved named items; multi-language reading; agent-initiated check-in call; move-out before/after diff as a pitch back pocket.

## 4. Architecture

### Magnifier fallback ladder (confirmed)
1. Publish our rendered large-text frames as the agent's LiveKit video track (best, if allowed).
2. Send the enlarged high-contrast text as an **iMessage image** during/right after the call (documented, safe).
3. Voice-only read-aloud plus the iMessage image summary.

**Ask Chert staff at the venue in hour 0:** (1) Is caller vision enabled on our line? (2) Can our own LiveKit agent publish a custom video track to the caller? (3) Caller video frame rate/resolution?

### Pipeline
```
iPhone --FaceTime--> Chert --LiveKit room--> Our agent (TypeScript)
                                                |
                  Gemini (vision + OCR-style reading, Live voice if viable)
                                                |
        +--- render large-text frames --> video track OR iMessage image
        +--- spoken reply ---------------> caller's ears
        +--- frames + detected objects + embeddings --> MongoDB Atlas
                                                |
iMessage question --> Chert webhook/SSE --> Our server --> Atlas vector search
                                  --> iMessage reply + frame
```

### Components
- **Server/agent:** TypeScript (Node + Express). Chert CLI starter for the LiveKit agent; Express for the iMessage webhook and dashboard API.
- **Vision:** Gemini API (Flash-class model for speed).
- **Embeddings/lookup:** Gemini embeddings for object labels.
- **Database:** MongoDB Atlas (free tier). Collections: `sessions`, `events`, `sightings`. Atlas Vector Search. Frames kept **7 days**; support iMessage **"delete my data"**.
- **Magnifier renderer:** server-side canvas/HTML-to-image. Themes: white on black, yellow on black, black on white.
- **Dashboard:** minimal React page — transcript, latest frame, large-text output, sightings table.

### Voice (confirmed)
ElevenLabs pipeline: ElevenLabs STT (Scribe) → Gemini LLM → ElevenLabs TTS. Not OpenAI Realtime.

### Testing without the Shared line (confirmed)
Use recorded sample frames/photos for vision + memory offline. Book short slots for real FaceTime.

## 5. Timeline (24 hours, H+0 = start of building)

| Hours | Phase | Goal | Done when |
|---|---|---|---|
| H+0 to H+1 | **0. Setup** | Chert connected, repo created, API questions from Section 4 asked, prize rules checked (Gemini, MongoDB), Atlas + LiveKit accounts ready | We can text the agent and get a reply; we know if caller vision and custom video work |
| H+1 to H+4 | **1. Walking skeleton** | FaceTime call -> agent sees a caller frame -> Gemini describes it -> spoken answer. Events logged to Mongo | End to end works, however ugly |
| H+4 to H+9 | **2. Magnifier MVP** | Read text aloud + large-text output (video or iMessage image per fallback ladder); follow-up Q&A | 5 test props read reliably |
| H+9 to H+14 | **3. Find my things** | Room scan indexes objects into Atlas; iMessage "where is X?" returns last-seen + frame | Works on 3 objects across two sessions |
| H+14 to H+17 | **4. Handoff + dashboard** | Post-call summary text, medication/label safety wording, graceful failures, minimal dashboard | Summary arrives after a real call; dashboard shows a live call |
| H+17 to H+19 | **5. Polish** | Odyssey theming/persona, contrast themes, prize-specific touches | Only if 1-4 are solid |
| **H+19** | **Feature freeze** | Bug fixes only | |
| H+19 to H+22 | **6. Hardening** | Run the full demo; fix flakiness; optional backup video | Demo script works |
| H+22 to H+24 | **7. Submit + pitch** | Submission + slides + rehearse | Submitted well before the deadline |

## 6. Demo plan (3 min + 2 min Q&A)

- Props: a menu, a medication box, a snack with allergen text, a letter, keys, a pill bottle, a cane or similar.
- Script (about 90 seconds live):
  1. Call the agent. Point at the menu; it reads aloud and shows large text.
  2. Ask "any vegetarian options?" and get a spoken answer.
  3. Pan the room once.
  4. Hang up. Have a judge hide the keys. Text "where are my keys?" and show the reply with the frame.
  5. Show the summary iMessage and the dashboard.
- **Backup:** pre-recorded screen capture in case Wi-Fi, the shared line, or Chert fails.
- **Success criteria (confirmed):** live stage demo works once (magnify + find-keys + summary).

## 7. Accessibility and safety considerations

- Responses are short and speakable: no markdown, no long lists.
- Large-text output: high-contrast themes, big sans-serif font, minimal motion, reflowed text.
- Don't present medication or safety information as authoritative. Read what's on the label, say when unsure, suggest a pharmacist or a person.
- **Privacy:** retain frames **7 days**; iMessage command **"delete my data"** wipes user data; always say when/where an object was last seen, never claim it is still there.
- Graceful failure: blurry image, bad lighting, no text found, object not seen.

## 8. Risks

- No custom outgoing video from the agent. **Mitigation:** fallback ladder in Section 4.
- Caller vision not enabled on our line, or capture includes FaceTime UI. **Mitigation:** test in hour 0; ask staff.
- Gemini Live inside LiveKit doesn't work smoothly. **Mitigation:** OpenAI Realtime after ≤1 hour.
- Shared line contention. **Mitigation:** sample photos offline; scheduled call slots.
- Scope creep. **Mitigation:** Section 3 MVP is the contract; freeze at H+19.

## 9. Decisions so far

- Demo format: science fair, 3 + 2 minutes.
- Prizes are stackable. Targets: Chert, Gemini, MongoDB (plus Main Track).
- MVP cut: magnifier + room scan + find-by-text + summary.
- Target user: people with low vision. No community interview this hackathon.
- Stack: TypeScript, Gemini vision + LLM, ElevenLabs STT/TTS, MongoDB Atlas, minimal React dashboard.
- Magnifier: try custom video track first; fall back to iMessage large-text image.
- Privacy: 7-day retention; "delete my data" by text.
- Testing: sample photos offline; real FaceTime in booked slots.
- Success: live stage demo works once.
- Prize rules: skim at H+0; assume Atlas + vector search + Gemini vision in write-up count.
- Timeline clock: H+0 = start of building; exact deadline TBD.
- Odyssey theme: deferred until after H+14.
- Tooling: Cursor.
- Chert: signed in; project `c7add437-4325-44ff-92ef-a9a859309c44`; line `+16504444331`.

## 10. Still OPEN

1. Exact submission deadline and judging slot (clock times).
2. Caller vision enabled on our line? Custom video track allowed? Frame rate/resolution? (ask Chert staff, hour 0)
3. MongoDB and Gemini prize rule specifics after skimming at H+0.
