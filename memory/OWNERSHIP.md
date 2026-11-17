# Ownership (short)

Argo AI is a **two-person HackUTA project** on top of public engines (LiveKit, Chert, Gemini, ElevenLabs, Express, MongoDB).

### Team split (from git)

| Person | Owned |
|--------|--------|
| **Anthony Salto** | Agent pipeline MVP, iMessage PNG handouts + themes, session/docs/landing (**Argo AI**), merges into a demoable build |
| **Manuel De La Cruz** | Argos Odyssey avatar + Fill framing, live call UX (when to look, greet/lower-phone, follow-up pictures, stop/echo) |

### Ours vs frameworks

- **Ours:** prompts, turn routing, Chert greet timing, Argos `drawFace`, iMessage handout path, Mongo event schema, product UX.
- **Not ours:** LiveKit Agents, STT/TTS/LLM weights, Chert FaceTime bridge, Express/Mongo drivers.

See [`../handoff.md`](../handoff.md) for the full product handoff and [`IMPLEMENTATION_LOG.md`](./IMPLEMENTATION_LOG.md) for decision history.
