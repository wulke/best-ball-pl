import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamsFilter } from './TeamsFilter.js';

test('lists only slate teams with included counts and checked state', () => {
  const html = renderToStaticMarkup(
    <TeamsFilter
      teams={new Set(['LIV', 'NFO', 'BOU', 'EVE'])}
      excludedTeams={new Set(['LIV'])}
      open
      onOpenChange={() => {}}
      onToggleTeam={() => {}}
    />,
  );

  assert.ok(html.includes('Teams ('));
  assert.ok(html.includes('>3/4<'));
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="Include LIV players on the sheet"/);
  const livInput = html.match(/<input[^>]*aria-label="Include LIV players on the sheet"[^>]*>/)?.[0];
  assert.ok(livInput);
  assert.ok(!livInput.includes('checked=""'));
  assert.match(html, /aria-label="Exclude NFO players on the sheet"[^>]*name="teams-filter"[^>]*checked=""[^>]*value="NFO"/);
  assert.match(html, />BOU</);
  assert.match(html, />EVE</);
});

test('closed control does not render its checklist', () => {
  const html = renderToStaticMarkup(
    <TeamsFilter
      teams={new Set(['LIV', 'NFO'])}
      excludedTeams={new Set()}
      open={false}
      onOpenChange={() => {}}
      onToggleTeam={() => {}}
    />,
  );

  assert.ok(html.includes('Teams ('));
  assert.ok(html.includes('>2/2<'));
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('name="teams-filter"'));
});
