/**
 * The per-draft review panel (#18's lenses, in order): headline roster score →
 * per-pick deviation → pseudo-starters + tier mix → club coverage grid →
 * carry-forward card. Budget: 5–15 min per draft.
 */
import { useMemo } from 'react';
import type { SnapshotPlayer } from '../types.js';
import type { PickLogEntry } from './types.js';
import { reviewRoom } from './review.js';
import { FALSE_NINE, type ContestProfile } from '../../contest/profiles.js';
import { CarryCard } from './CarryCard.js';

const POS_BADGE: Record<string, string> = {
  G: 'border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

const QUARTILE_SHADE = [
  'bg-accent/30',
  'bg-accent/20',
  'bg-accent/10',
  '',
];

type Props = {
  pool: SnapshotPlayer[];
  picks: PickLogEntry[];
  myTeam: string;
  carryNote: string;
  onCarryNoteChange: (note: string) => void;
  /** Contest profile the room drafted under — roster shape drives the lenses. */
  profile?: ContestProfile;
};

const SECTION_TITLE = 'font-condensed text-sm font-semibold uppercase tracking-wider text-accent';
const PANEL = 'rounded-md border border-default bg-surface';

export function ReviewPanel({ pool, picks, myTeam, carryNote, onCarryNoteChange, profile = FALSE_NINE }: Props) {
  const review = useMemo(
    () => reviewRoom(pool, picks, myTeam, profile),
    [pool, picks, myTeam, profile],
  );
  if (!review) return null;

  const { headline, deviations, starters, tierMix, clubGrid, flags } = review;

  return (
    <div className="flex flex-col gap-3">
      {/* Chips + headline (lens 2) */}
      <section className={PANEL}>
        <div className="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
          <span className={SECTION_TITLE}>Room review</span>
          <div className="ml-auto flex flex-wrap items-center gap-1 text-xs tabular-nums text-muted">
            <span>{review.pickCount} picks</span>
            <span>· {review.teamCount} teams</span>
            <span>· {review.matchedCount} matched</span>
            <span>· {review.unmatchedCount} unmatched</span>
            {review.partialLog && (
              <span
                className="rounded border border-negative/30 bg-negative/10 px-1 py-0.5 font-semibold text-negative"
                title="BPA math needs the full room log — add missing picks before trusting deviations"
              >
                partial log
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2">
          <div>
            <p className="font-condensed text-3xl font-bold tabular-nums text-primary">
              {headline.percent.toFixed(0)}
              <span className="text-lg text-muted">%</span>
            </p>
            <p className="text-xs text-muted">of sheet-perfect (tournament score)</p>
          </div>
          <div className="text-sm tabular-nums text-secondary">
            <p>
              {headline.rosterScore.toFixed(0)} vs {headline.sheetPerfectScore.toFixed(0)} pts —
              ceiling-weighted
            </p>
            <p className="text-muted">
              raw p50: {headline.rosterP50.toFixed(0)} vs {headline.sheetPerfectP50.toFixed(0)} (
              {headline.p50Percent.toFixed(0)}%)
            </p>
          </div>
          {review.unmatchedMine.length > 0 && (
            <div className="text-xs text-muted">
              <p className="font-semibold text-secondary">Unmatched own picks (outside the model):</p>
              {review.unmatchedMine.map((u) => (
                <p key={u.pick}>
                  R{u.round} #{u.pick} — {u.rawName}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Per-pick deviation (lens 1) */}
      <section className={PANEL}>
        <div className="flex items-baseline gap-2 border-b border-default px-3 py-2">
          <span className={SECTION_TITLE}>Per-pick deviation</span>
          <span className="text-xs text-muted">
            each own pick vs the best sheet player still on the board
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-strong">
                {['#', 'Rnd', 'My pick', 'Pos', 'T', 'Pts', 'BPA on board', 'ΔPts', 'ΔRk', 'Best same pos', 'ΔPts'].map(
                  (h, i) => (
                    <th
                      key={i}
                      className="font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted px-1 py-1 text-left whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {deviations.map((row) => {
                const bpa = row.rankDelta <= 2;
                const hot = row.scoreDelta >= 25;
                const warm = row.scoreDelta >= 10 && !hot;
                return (
                  <tr key={row.pick} className="border-b border-default last:border-b-0 hover:bg-surface-hover">
                    <td className="px-1 py-1 text-xs tabular-nums text-muted">{row.pick}</td>
                    <td className="px-1 py-1 text-xs tabular-nums text-muted">{row.round}</td>
                    <td className="px-1 py-1 text-sm font-medium text-primary">{row.mine.name}</td>
                    <td className="px-1 py-1">
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase leading-none tracking-wide ${POS_BADGE[row.mine.position]}`}
                      >
                        {row.mine.position}
                      </span>
                    </td>
                    <td className="px-1 py-1 text-xs tabular-nums text-muted">
                      T{row.mine.projection?.tier}
                    </td>
                    <td className="px-1 py-1 text-sm tabular-nums text-secondary">
                      {score(row.mine)}
                    </td>
                    <td className="px-1 py-1 text-sm text-secondary">
                      {row.bpa.name}
                      <span className="ml-1 text-xs text-muted">{row.bpa.position}</span>
                      {bpa ? (
                        <span className="ml-1.5 rounded border border-positive/40 px-1 text-[0.65rem] font-semibold text-positive">
                          BPA
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`px-1 py-1 text-sm tabular-nums font-semibold ${
                        hot ? 'text-negative' : warm ? 'text-info' : 'text-muted'
                      }`}
                    >
                      {row.scoreDelta >= 0.5 ? `−${row.scoreDelta.toFixed(0)}` : '—'}
                    </td>
                    <td className="px-1 py-1 text-xs tabular-nums text-muted">
                      {row.rankDelta > 0 ? `+${row.rankDelta}` : '—'}
                    </td>
                    <td className="px-1 py-1 text-sm text-muted">
                      {row.posBpa ? row.posBpa.name : '—'}
                    </td>
                    <td className="px-1 py-1 text-xs tabular-nums text-muted">
                      {row.posBpa && row.posScoreDelta >= 0.5 ? `−${row.posScoreDelta.toFixed(0)}` : '—'}
                    </td>
                  </tr>
                );
              })}
              {deviations.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-2 py-4 text-center text-sm text-muted">
                    No matched own picks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pseudo-starters + tier mix (lenses 3+4) */}
      <section className={PANEL}>
        <div className="flex items-baseline gap-2 border-b border-default px-3 py-2">
          <span className={SECTION_TITLE}>Best {starters.slots.length} (pseudo-starters)</span>
          <span className="ml-auto text-xs tabular-nums text-muted">
            {starters.legal ? 'legal lineup' : `short: ${starters.missing.join('/')}`} ·{' '}
            {starters.total.toFixed(0)} pts
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1 px-2 py-2 sm:grid-cols-3 lg:grid-cols-9">
          {starters.slots.map((slot, index) => (
            <div
              key={index}
              className={`rounded border px-2 py-1 ${
                slot.player ? 'border-default bg-surface' : 'border-negative/30 bg-negative/5'
              }`}
            >
              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                {slot.slot === 'FLEX' ? 'FLEX' : slot.slot}
              </p>
              {slot.player ? (
                <>
                  <p className="truncate text-sm font-medium text-primary" title={slot.player.fullName}>
                    {slot.player.name}
                  </p>
                  <p className="text-xs tabular-nums text-secondary">
                    {score(slot.player)} pts · T{slot.player.projection?.tier}
                  </p>
                </>
              ) : (
                <p className="text-sm text-negative">empty</p>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-default px-3 py-2 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider text-accent">Tier mix</span>
          {tierMix.starters.slice(1).map((count, i) => (
            <span key={i} className="tabular-nums">
              T{i + 1}: <span className="text-secondary">{count}</span>
              <span className="text-muted">st</span> / {tierMix.bench[i + 1]}
              <span className="text-muted">bn</span>
            </span>
          ))}
          {tierMix.floorRatio !== null && (
            <span className="tabular-nums" title="Average p10/p50 across pseudo-starters — low means spike-heavy, thin floor">
              floor ratio {tierMix.floorRatio.toFixed(2)}
            </span>
          )}
        </div>
      </section>

      {/* Club coverage grid (lens 5) */}
      <section className={PANEL}>
        <div className="flex items-baseline gap-2 border-b border-default px-3 py-2">
          <span className={SECTION_TITLE}>Club coverage</span>
          <span className="text-xs text-muted">
            shaded by model strength — G/D by clean-sheet quartile, MD/FW by attack quartile (dark =
            strongest)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-strong">
                {['Club', 'G', 'D', 'MD', 'FW', 'Σ', 'CS q', 'Att q'].map((h, i) => (
                  <th
                    key={i}
                    className="font-condensed text-[0.65rem] font-semibold uppercase tracking-wider text-muted px-1 py-1 text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clubGrid.rows.map((row) => (
                <tr
                  key={row.club}
                  className={`border-b border-default last:border-b-0 ${
                    row.total > 0 ? '' : 'opacity-50'
                  } hover:bg-surface-hover`}
                >
                  <td className="px-1 py-1 text-sm font-medium text-secondary">{row.club}</td>
                  {(['G', 'D'] as const).map((pos) => (
                    <td
                      key={pos}
                      className={`px-1 py-1 text-sm tabular-nums ${QUARTILE_SHADE[row.defenseQuartile - 1]} ${
                        row.counts[pos] > 0 ? 'font-bold text-primary' : 'text-muted'
                      }`}
                    >
                      {row.counts[pos] || '·'}
                    </td>
                  ))}
                  {(['MD', 'FW'] as const).map((pos) => (
                    <td
                      key={pos}
                      className={`px-1 py-1 text-sm tabular-nums ${QUARTILE_SHADE[row.attackQuartile - 1]} ${
                        row.counts[pos] > 0 ? 'font-bold text-primary' : 'text-muted'
                      }`}
                    >
                      {row.counts[pos] || '·'}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-sm tabular-nums text-secondary">
                    {row.total || ''}
                  </td>
                  <td className="px-1 py-1 text-xs tabular-nums text-muted">
                    {row.defenseQuartile}
                  </td>
                  <td className="px-1 py-1 text-xs tabular-nums text-muted">
                    {row.attackQuartile}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Carry-forward card (lens 6) */}
      <CarryCard flags={flags} note={carryNote} onNoteChange={onCarryNoteChange} />
    </div>
  );
}

function score(player: SnapshotPlayer): string {
  return (player.projection?.tournamentScore ?? 0).toFixed(0);
}
