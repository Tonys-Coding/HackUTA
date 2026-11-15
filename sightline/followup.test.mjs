import assert from 'node:assert/strict';
import { contentFitsLastRead, routeTurn, wantsFreshLook } from './followup.mjs';

const ingredients = 'Ingredients: water, sugar, salt. Sodium 140 mg. Calories 250.';

assert.equal(routeTurn('what about sodium', ingredients), 'follow_up');
assert.equal(routeTurn('any peanuts', ingredients), 'follow_up');
assert.equal(routeTurn('what do you think the food item is', ingredients), 'follow_up');
assert.equal(routeTurn('what is this', ingredients), 'follow_up');
assert.equal(routeTurn("what's this food", ingredients), 'follow_up');
assert.equal(routeTurn('based on the ingredients what is it', ingredients), 'follow_up');

assert.equal(routeTurn('read this', ingredients), 'fresh');
assert.equal(routeTurn('what are the judging criteria', ingredients), 'fresh');
assert.equal(routeTurn('read the bullet points', ingredients), 'fresh');
assert.equal(routeTurn('something else now', ingredients), 'fresh');
assert.equal(routeTurn('look at this poster', ingredients), 'fresh');

assert.equal(wantsFreshLook('what about sodium', ingredients), false);
assert.equal(wantsFreshLook('judging criteria please', ingredients), true);
assert.equal(contentFitsLastRead('sodium amount', ingredients), true);
assert.equal(contentFitsLastRead('judging criteria', ingredients), false);

console.log('followup tests ok');
