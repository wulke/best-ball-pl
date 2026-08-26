/**
 * #98 override-store guards: the pure map edits (set/clear/prune), the chip
 * cycle order, and the localStorage round-trip — malformed storage must never
 * block model-default minutes, and a fully-unwound slate must leave no key.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StartOverrideMap } from '../model/lineups.js';
import {
  loadStartOverrides,
  nextManualCall,
  saveStartOverrides,
  setStartCall,
} from './startOverrides.js';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

test('setStartCall sets, overwrites, and prunes empty records', () => {
  let map: StartOverrideMap = {};
  map = setStartCall(map, 'p1', 14, 'starter');
  map = setStartCall(map, 'p2', 15, 'bench');
  assert.deepEqual(map, { p1: { 14: 'starter' }, p2: { 15: 'bench' } });

  map = setStartCall(map, 'p1', 14, 'bench'); // overwrite in place
  assert.deepEqual(map.p1, { 14: 'bench' });

  map = setStartCall(map, 'p1', 14, null); // clear → player record pruned
  assert.deepEqual(map, { p2: { 15: 'bench' } });

  map = setStartCall(map, 'p2', 15, null); // clear last → empty map, no orphan keys
  assert.deepEqual(map, {});
});

test('chip cycle runs none → starter → bench → none', () => {
  assert.equal(nextManualCall(null), 'starter');
  assert.equal(nextManualCall('starter'), 'bench');
  assert.equal(nextManualCall('bench'), null);
});

test('overrides persist per profile and round-trip through storage', () => {
  saveStartOverrides('free-kick-gw2-sat', { p1: { 14: 'starter' } });
  assert.deepEqual(loadStartOverrides('free-kick-gw2-sat'), { p1: { 14: 'starter' } });
  assert.equal(loadStartOverrides('free-kick-gw1-sat'), undefined, 'keys are per profile+slate');

  saveStartOverrides('free-kick-gw2-sat', {}); // empty map clears the key
  assert.equal(loadStartOverrides('free-kick-gw2-sat'), undefined);
});

test('malformed stored overrides never block model-default minutes', () => {
  store.set('bbpl-start-overrides:broken', '{"p1": 42}');
  assert.equal(loadStartOverrides('broken'), undefined);
  store.set('bbpl-start-overrides:broken', 'not json');
  assert.equal(loadStartOverrides('broken'), undefined);
  assert.equal(loadStartOverrides('absent'), undefined);
});
