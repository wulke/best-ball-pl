import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FALSE_NINE, FREE_KICK_GW1_SAT } from '../../contest/profiles.js';
import { defaultCompetition } from './types.js';

test('new rooms derive a freely editable competition label from the active profile', () => {
  assert.equal(defaultCompetition(FREE_KICK_GW1_SAT), 'The Free Kick — GW1 Saturday slate (Aug 22)');
  assert.equal(defaultCompetition(FALSE_NINE), 'False Nine — season best ball');
});
