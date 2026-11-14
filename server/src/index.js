import cors from 'cors';
import express from 'express';
import { deleteAllUserData, getDb, logEvent } from './db.js';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sightline-server' });
});

/** Dashboard + agent both write here so judges can see what happened. */
app.post('/api/events', async (req, res) => {
  try {
    const doc = await logEvent(req.body || {});
    res.status(201).json({ id: doc._id });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    const database = await getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await database
      .collection('events')
      .find({})
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.get('/api/sightings', async (req, res) => {
  try {
    const database = await getDb();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const sightings = await database
      .collection('sightings')
      .find({})
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    res.json({ sightings });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

/**
 * iMessage "delete my data" will hit this (wired in Phase 3/4).
 * For now: manual/test endpoint.
 */
app.post('/api/privacy/delete', async (_req, res) => {
  try {
    const result = await deleteAllUserData();
    await logEvent({ type: 'privacy.delete_all', result });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.listen(port, () => {
  console.log(`[sightline-server] http://localhost:${port}`);
});
