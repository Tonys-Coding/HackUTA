import assert from 'node:assert/strict';
import {
  THEME_OPTIONS_SPOKEN,
  bareThemePick,
  parseThemeRequest,
  wantsReadWithTheme,
} from './theme-pref.mjs';
import { isMeantForArgo } from './followup.mjs';

/** Mimic agent order after the fix: theme before background ignore. */
function route(userBits, { hasHistory = true, awaitingPick = false } = {}) {
  const themeReq = parseThemeRequest(userBits, { awaitingPick });
  if (themeReq?.kind === 'list') return 'THEME_LIST';
  if (themeReq?.kind === 'set') return `THEME_SET:${themeReq.theme}`;
  if (hasHistory && !isMeantForArgo(userBits)) return 'BACKGROUND_IGNORED';
  return 'OTHER';
}

assert.equal(route('change theme'), 'THEME_LIST');
assert.equal(route('change the theme'), 'THEME_LIST');
assert.equal(route('can you change the theme'), 'THEME_LIST');
assert.equal(route('I want to change the theme'), 'THEME_LIST');
assert.equal(route('switch the contrast'), 'THEME_LIST');
assert.equal(route('theme options'), 'THEME_LIST');

assert.equal(route('change theme to yellow'), 'THEME_SET:black-on-yellow');
assert.equal(route('change it to cream'), 'THEME_SET:dark-on-cream');
assert.equal(route('use yellow'), 'THEME_SET:black-on-yellow');
assert.equal(route('make it dark'), 'THEME_SET:white-on-black');
assert.equal(route('high contrast'), 'THEME_SET:black-on-yellow');

// After options prompt: bare picks
assert.equal(route('yellow', { awaitingPick: true }), 'THEME_SET:black-on-yellow');
assert.equal(route('cream', { awaitingPick: true }), 'THEME_SET:dark-on-cream');
assert.equal(route('white', { awaitingPick: true }), 'THEME_SET:black-on-white');
assert.equal(route('dark', { awaitingPick: true }), 'THEME_SET:white-on-black');
assert.equal(route('yellow please', { awaitingPick: true }), 'THEME_SET:black-on-yellow');
assert.equal(route('go with cream', { awaitingPick: true }), 'THEME_SET:dark-on-cream');

// Echo of options line is not a cream set
assert.equal(parseThemeRequest(THEME_OPTIONS_SPOKEN), null);
assert.equal(parseThemeRequest('Say cream, yellow, white, or dark'), null);

assert.equal(bareThemePick('yellow'), 'black-on-yellow');
assert.equal(wantsReadWithTheme('use yellow'), false);
assert.equal(wantsReadWithTheme('read this in yellow'), true);

console.log('theme-pref tests ok');
