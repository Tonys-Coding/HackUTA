import assert from 'node:assert/strict';
import {
  createReadDigest,
  normalizeReadText,
  wantsFullDigest,
  wantsLargeTextSend,
} from './large-text-send.mjs';

assert.equal(wantsLargeTextSend('text me that'), true);
assert.equal(wantsLargeTextSend('send large text'), true);
assert.equal(wantsLargeTextSend('send what you read'), true);
assert.equal(wantsLargeTextSend('send that'), true);
assert.equal(wantsLargeTextSend('send me a list of ingredients'), true);
assert.equal(wantsLargeTextSend('send me the ingredients'), true);
assert.equal(wantsLargeTextSend('text me the ingredients list'), true);
assert.equal(wantsLargeTextSend('send me the poem'), true);
assert.equal(wantsLargeTextSend('text me the poem'), true);
assert.equal(wantsLargeTextSend('send me that support message'), true);
assert.equal(wantsLargeTextSend('send me this'), false);
assert.equal(wantsLargeTextSend('read this'), false);
assert.equal(wantsLargeTextSend('what about sodium'), false);
assert.equal(wantsFullDigest('send everything you read'), true);

const d = createReadDigest({ maxEntries: 8 });
d.append(
  'Nutrition Facts. Serving size 1 cup. Calories 250. Sodium 140 mg. Ingredients: water, sugar, salt.',
  'Nutrition label with sodium and calories.',
);
d.append(
  'Nutrition Facts. Serving size 1 cup. Calories 250. Sodium 140 mg. Ingredients: water, sugar, salt.',
); // dup ignored
assert.equal(d.count(), 1);

const ingredients = d.pickHandout('send me the ingredients');
assert.match(ingredients, /Sodium/);
assert.equal(d.alreadySent(ingredients), false);
d.markSent(ingredients);
assert.equal(d.alreadySent(ingredients), true);

d.append(
  'Life is a barren field Frozen with snow. — Langston Hughes',
  'A short poem by Langston Hughes.',
);
d.append(
  'Hi, thanks for contacting support. Your ticket 4421 is open. We will reply within 24 hours.',
  'A support message about ticket 4421.',
);

// Second send must pick the poem — not re-deny or re-ship the ingredients blob.
const poem = d.pickHandout('send me the poem');
assert.match(poem, /barren field/i);
assert.equal(d.alreadySent(poem), false);
d.markSent(poem);
assert.equal(d.alreadySent(poem), true);
assert.equal(d.alreadySent(ingredients), true);

const support = d.pickHandout('text me the support message');
assert.match(support, /ticket 4421/i);
assert.equal(d.alreadySent(support), false);
d.markSent(support);

// Generic "text me that" after all three sent → latest (already sent) still returns latest.
const latest = d.pickHandout('text me that');
assert.match(latest, /ticket 4421/i);

assert.equal(normalizeReadText('  Hello, WORLD!  '), 'hello world');

console.log('large-text-send tests ok');
