import assert from 'node:assert/strict';
import {
  createReadDigest,
  normalizeReadText,
  wantsLargeTextSend,
} from './large-text-send.mjs';

assert.equal(wantsLargeTextSend('text me that'), true);
assert.equal(wantsLargeTextSend('send large text'), true);
assert.equal(wantsLargeTextSend('send what you read'), true);
assert.equal(wantsLargeTextSend('send that'), true);
assert.equal(wantsLargeTextSend('send me a list of ingredients'), true);
assert.equal(wantsLargeTextSend('send me the ingredients'), true);
assert.equal(wantsLargeTextSend('text me the ingredients list'), true);
assert.equal(wantsLargeTextSend('send me this'), false);
assert.equal(wantsLargeTextSend('read this'), false);
assert.equal(wantsLargeTextSend('what about sodium'), false);

const d = createReadDigest({ maxEntries: 3 });
d.append('Sodium 140 mg');
d.append('Sodium 140 mg'); // dup
d.append('Calories 250');
assert.equal(d.count(), 2);
assert.match(d.digest(), /Sodium/);
assert.match(d.digest(), /Calories/);
assert.equal(d.alreadySent(d.digest()), false);
d.markSent(d.digest());
assert.equal(d.alreadySent(d.digest()), true);
assert.equal(normalizeReadText('  Hello, WORLD!  '), 'hello world');

console.log('large-text-send tests ok');
