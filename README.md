# Argo

FaceTime helper for low-vision users. You call Argo, show something to the camera (a label, menu, bottle, receipt), and ask in plain language. Argo answers out loud. When you want the words to keep, say **text me that** and it sends a large-print, high-contrast PNG to iMessage.

Built for HackUTA on Chert FaceTime + a LiveKit agent in `sightline/`.

---

## Try it (simplest path)

You do **not** need to install anything.

1. **FaceTime Video** call the Argo line your team is running (the number Chert shows for the active demo, e.g. the shared trial line).
2. Wait for the greeting, then hold something up and ask, for example:
   - "Read this"
   - "How much sodium?"
   - "What are the ingredients?"
3. Optional: **"Text me that"** (or "text me the ingredients") to get a large-text image in Messages.
4. Optional theme for that image: say **"change theme"**, then **cream**, **yellow**, **white**, or **dark**.
5. Say **stop** if you want Argo to quit talking mid-read.
6. After a call, you can **iMessage** the same line with a follow-up ("what was the caffeine?") if the inbox poller is running on the demo machine.

NOTE: Someone on the team has to have `npm start` + `chert dev` running, or the call will not connect to Argo.

---

## Run the demo yourself (team)

Needs Node 22.23.2+ (or 24/26), LiveKit (or Chert shared LiveKit), ElevenLabs, Gemini, and a Chert FaceTime project.

```bash
git clone https://github.com/Tonys-Coding/HackUTA.git
cd HackUTA/sightline
npm install
cp .env.example .env.local   # fill in keys; chmod 600 .env.local
```

**Terminal 1 — agent**

```bash
cd sightline
npm start
```

**Terminal 2 — FaceTime slot**

```bash
cd sightline
npx @trychert/facetime@0.1.0-beta.21 dev --agent argo --minutes 60 --force --takeover
```

When it says Argo is in the waiting room, FaceTime Video the line it prints.

**Terminal 3 (optional) — iMessage recall**

```bash
cd sightline
npm run imessage:inbox
```

That polls inbound texts and answers from past FaceTime reads saved on this machine.

Fill `sightline/.env.local` from `.env.example` (`ELEVEN_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, LiveKit or Chert shared settings, `CHERT_*` for iMessage). Keep secrets out of git.

---

## What to say (cheat sheet)

| You say | Argo does |
| --- | --- |
| Read this / what is this? | Looks at the camera and answers |
| How much sodium? / ingredients? | Answers from the last pictures this call |
| Text me that | Sends a large-text PNG to iMessage |
| Text me the poem / ingredients | Sends the matching saved read (not a mixed blob) |
| Change theme → cream / yellow / white / dark | Sets PNG contrast; sends a sample |
| Stop | Stops talking |

PNG themes aim for WCAG-level contrast (about 15:1–21:1) using common low-vision palettes (black on cream/yellow, light on black). Pinch to zoom in Messages.

---

## Repo map

- `sightline/` — FaceTime agent (`agent.mjs`), vision, iMessage PNG + inbox
- `avatar/` — on-call FaceTime face video
- `server/` — optional local API / event logging

Default branch is **main** (this Argo build).
