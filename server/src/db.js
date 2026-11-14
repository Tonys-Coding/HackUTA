import { MongoClient } from 'mongodb';

let client;
let db;

/**
 * Connect once and reuse. Why a singleton: Atlas free tier hates many
 * short-lived connections from a long-running agent + Express process.
 */
export async function getDb() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('YOUR_')) {
    throw new Error('Set MONGODB_URI in .env.local (Atlas connection string).');
  }
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'sightline');
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(database) {
  await database.collection('events').createIndex({ ts: -1 });
  await database.collection('sightings').createIndex({ ts: -1 });
  await database.collection('sightings').createIndex({ object: 1, ts: -1 });
  // Auto-delete frames/sightings after 7 days (privacy decision).
  await database.collection('sightings').createIndex(
    { ts: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 7 },
  );
  await database.collection('frames').createIndex(
    { ts: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 7 },
  );
}

export async function logEvent(event) {
  const database = await getDb();
  const doc = { ...event, ts: event.ts ? new Date(event.ts) : new Date() };
  await database.collection('events').insertOne(doc);
  return doc;
}

export async function deleteAllUserData() {
  const database = await getDb();
  const [events, sightings, frames, sessions] = await Promise.all([
    database.collection('events').deleteMany({}),
    database.collection('sightings').deleteMany({}),
    database.collection('frames').deleteMany({}),
    database.collection('sessions').deleteMany({}),
  ]);
  return {
    events: events.deletedCount,
    sightings: sightings.deletedCount,
    frames: frames.deletedCount,
    sessions: sessions.deletedCount,
  };
}
