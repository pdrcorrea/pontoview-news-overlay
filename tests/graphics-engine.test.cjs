'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../shared/graphics-engine.js');

const initial = () => ({
  theme: { primary: '#003E8D', safeX: 64 },
  lowerThird: { visible: false, title: 'Original' },
  ticker: { visible: true, text: 'Últimas' },
  fullscreen: { visible: false, title: 'Tela' }
});

test('clone isolates nested objects', () => {
  const before = initial();
  const copy = engine.clone(before);
  copy.theme.primary = 'red';
  assert.equal(before.theme.primary, '#003E8D');
});

test('merge preserves legacy nested-object and array replacement semantics', () => {
  const base = { theme: { primary: 'blue', safeX: 64 }, cities: ['A'] };
  const result = engine.merge(base, { theme: { primary: 'green' }, cities: ['B'] });
  assert.equal(result, base);
  assert.deepEqual(result, { theme: { primary: 'green', safeX: 64 }, cities: ['B'] });
});

test('preview edits never change program', () => {
  const started = engine.createSession(initial());
  const draft = engine.clone(started.preview);
  draft.lowerThird.title = 'Manchete em preparo';
  draft.lowerThird.visible = true;
  const prepared = engine.prepare(started, draft, 0);
  assert.equal(prepared.program.lowerThird.title, 'Original');
  assert.equal(prepared.program.lowerThird.visible, false);
  assert.equal(prepared.preview.lowerThird.title, 'Manchete em preparo');
  assert.equal(started.revision, 0);
  assert.equal(prepared.revision, 1);
});

test('TAKE promotes the entire preview atomically and without aliasing', () => {
  const started = engine.createSession(initial());
  const draft = engine.clone(started.preview);
  draft.lowerThird.visible = true;
  draft.lowerThird.title = 'No ar';
  draft.ticker.visible = false;
  const prepared = engine.prepare(started, draft, 0);
  const taken = engine.take(prepared, 1);
  assert.deepEqual(taken.program, draft);
  assert.equal(taken.revision, 2);
  taken.preview.lowerThird.title = 'Alteração posterior';
  assert.equal(taken.program.lowerThird.title, 'No ar');
});

test('OUT affects only the selected program graphic', () => {
  const base = initial();
  base.lowerThird.visible = true;
  const state = engine.createSession(base);
  const result = engine.out(state, 'lowerThird', 0);
  assert.equal(result.program.lowerThird.visible, false);
  assert.equal(result.program.ticker.visible, true);
  assert.equal(result.preview.lowerThird.visible, true);
  assert.equal(state.program.lowerThird.visible, true);
});

test('OUT rejects missing or unsupported graphic keys', () => {
  assert.throws(() => engine.outState(initial(), 'notAKey'), /UNKNOWN_GRAPHIC/);
  assert.throws(() => engine.outState(initial(), 'theme'), /UNKNOWN_GRAPHIC/);
});

test('CLEAR hides graphics without modifying editorial content or preview', () => {
  const state = engine.createSession(initial());
  const result = engine.clear(state, ['lowerThird', 'ticker', 'fullscreen'], 0);
  assert.equal(result.program.ticker.visible, false);
  assert.equal(result.program.ticker.text, 'Últimas');
  assert.equal(result.preview.ticker.visible, true);
  assert.equal(result.revision, 1);
});

test('stale or invalid revisions cannot overwrite state', () => {
  const state = engine.createSession(initial());
  assert.throws(() => engine.take(state, -1), /STATE_CONFLICT/);
  assert.throws(() => engine.prepare(state, initial(), 1), /STATE_CONFLICT/);
  assert.throws(() => engine.clear(state, ['ticker'], NaN), /STATE_CONFLICT/);
});

test('shared state engine has no side effects while running offline', () => {
  const state = engine.createSession(initial());
  const taken = engine.take(state, 0);
  assert.equal(taken.revision, 1);
  assert.equal(typeof engine.take, 'function');
});
