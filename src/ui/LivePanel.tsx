/**
 * The live-draft panel (#7): roster shape, correlation watch, and next-pick
 * defaults — "From your queue" (the watch pool), "Best on board" (BPA), and
 * the model's default target per position. Collapsible; stays above the table.
 */
import type { Position, SnapshotPlayer } from './types.js';
import type { LiveRecs, Rec, TargetState } from './recommend.js';
import { Tooltip } from './Tooltip.js';
import { benchSize, type ContestProfile } from '../contest/profiles.js';
import { ruleTooltip } from '../stacking/rules.js';

const POS_BADGE: Record<string, string> = {
  G: 'border-pos-g/30 bg-pos-g/10 text-pos-g',
  D: 'border-pos-d/30 bg-pos-d/10 text-pos-d',
  MD: 'border-pos-md/30 bg-pos-md/10 text-pos-md',
  FW: 'border-pos-fw/30 bg-pos-fw/10 text-pos-fw',
};

const STATE_STYLE: Record<TargetState, string> = {
  need: 'border-negative/50 text-negative',
  ok: 'border-info/40 text-info',
  full: 'border-default text-muted',
};
const STATE_LABEL: Record<TargetState, string> = {
  need: 'NEED',
  ok: 'ok',
  full: 'full',
};

type Props = {
  recs: LiveRecs;
  roster: SnapshotPlayer[];
  open: boolean;
  onToggleOpen: () => void;
  /** Filter the board down to the queue. */
  queueOnly: boolean;
  onToggleQueueOnly: () => void;
  queueSize: number;
  /** Active contest profile — roster size + shape display (#39). */
  profile: ContestProfile;
};

export function LivePanel({
  recs,
  roster,
  open,
  onToggleOpen,
  queueOnly,
  onToggleQueueOnly,
  queueSize,
  profile,
}: Props) {
  return (
    <section className="rounded-md border border-default bg-surface print:hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
        <button
          type="button"
          onClick={onToggleOpen}
          className="font-condensed text-sm font-semibold uppercase tracking-wider text-accent"
        >
          {open ? '▾' : '▸'} Live draft
        </button>
        <span className="text-xs tabular-nums text-muted">
          {recs.picksLeft} picks left · {roster.length}/{profile.roster.rosterSize} on roster
          {benchSize(profile) === 0 && ' · no bench — all start'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {recs.shape.map((s) => (
            <Tooltip
              key={s.pos}
              text={
                s.pos === 'FLEX'
                  ? `${s.starter} FLEX starters — any position fills them; roster has ${s.count} drafted beyond the exact starters${
                      benchSize(profile) > 0 ? '; further overflow sits on the bench' : ''
                    }`
                  : `Starters need ${s.starter} ${s.pos} — roster has ${s.count}; balanced-shape target ${s.target}`
              }
            >
              <span
                className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tabular-nums tracking-wide ${STATE_STYLE[s.state]}`}
              >
                {s.pos} {s.count}/{s.starter}
              </span>
            </Tooltip>
          ))}
          <button
            type="button"
            onClick={onToggleQueueOnly}
            disabled={queueSize === 0}
            className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
              queueOnly
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-default text-secondary hover:border-strong hover:text-primary'
            }`}
            title="Show only queued players (your drafting pool)"
          >
            ★ Queue ({queueSize})
          </button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-2 px-3 py-2">
          {recs.clubChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                Correlation watch
              </span>
              {recs.clubChips.map((chip) => (
                <Tooltip
                  key={chip.club}
                  text={
                    chip.matchedRules.length > 0
                      ? chip.matchedRules.map((rule) => ruleTooltip(rule, chip.club)).join(' ')
                      : `${chip.count} players from ${chip.club} — correlated outcomes`
                  }
                >
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tabular-nums tracking-wide ${
                      chip.matchedRules.length > 0 || chip.count >= 3 || chip.attackers >= 2
                        ? 'border-negative/50 text-negative'
                        : 'border-default text-muted'
                    }`}
                  >
                    {chip.club} ×{chip.count}
                    {chip.matchedRules.map((rule) => ` ${rule.label}`).join('')}
                  </span>
                </Tooltip>
              ))}
            </div>
          )}

          {roster.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                My roster
              </span>
              {roster.map((p) => (
                <span
                  key={p.id}
                  className="rounded border border-default px-1.5 py-0.5 text-xs text-secondary"
                >
                  <span className={`font-semibold ${posColor(p.position)}`}>{p.position}</span>{' '}
                  {p.name}
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-2 lg:grid-cols-2">
            <RecList
              title="From your queue"
              hint="★ players still on the board — your drafting pool, best first"
              recs={recs.queued}
              empty="Nothing queued yet — ★ players as you spot them between picks."
            />
            <div className="flex flex-col gap-2">
              <RecList title="Best on board" hint="BPA by tournament score" recs={recs.bpa} />
              <div className="flex flex-col gap-1">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                  Default target by position
                </span>
                {recs.byPosition.map(({ pos, state, rec, floor, ceiling }) => {
                  const p50Labels: ('p10' | 'p50' | 'p90')[] = rec
                    ? [
                        ...(floor?.player.id === rec.player.id ? (['p10'] as const) : []),
                        'p50',
                        ...(ceiling?.player.id === rec.player.id ? (['p90'] as const) : []),
                      ]
                    : [];
                  return (
                  <div key={pos} className="flex flex-col gap-1 border-b border-default/50 pb-1.5 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5">
                      <Tooltip
                        text={
                          state === 'need'
                            ? 'NEED — below the starter minimum; fill this position'
                            : state === 'ok'
                              ? 'Starters covered; below the balanced-shape target'
                              : 'At or past the balanced-shape target'
                        }
                      >
                        <span
                          className={`w-10 shrink-0 rounded border px-1 py-0.5 text-center text-[0.65rem] font-semibold uppercase tracking-wide ${STATE_STYLE[state]}`}
                        >
                          {STATE_LABEL[state]}
                        </span>
                      </Tooltip>
                      {rec ? (
                        <>
                          <ScenarioTag labels={p50Labels} />
                          <RecRow rec={rec} scenario="p50" />
                        </>
                      ) : (
                        <span className="text-xs text-muted">none left</span>
                      )}
                    </div>
                    {floor && floor.player.id !== rec?.player.id && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0" />
                        <ScenarioTag labels={['p10']} />
                        <RecRow rec={floor} scenario="p10" />
                      </div>
                    )}
                    {ceiling && ceiling.player.id !== rec?.player.id && ceiling.player.id !== floor?.player.id && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0" />
                        <ScenarioTag labels={['p90']} />
                        <RecRow rec={ceiling} scenario="p90" />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RecList({
  title,
  hint,
  recs,
  empty,
}: {
  title: string;
  hint: string;
  recs: Rec[];
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted" title={hint}>
        {title}
      </span>
      {recs.length === 0 ? (
        <span className="text-xs text-muted">{empty ?? '—'}</span>
      ) : (
        recs.map(({ player, tags }) => <RecRow key={player.id} rec={{ player, tags }} />)
      )}
    </div>
  );
}

const SCENARIO_TITLE: Record<'p10' | 'p50' | 'p90', string> = {
  p10: 'Highest floor — safest points outcome at this position',
  p50: 'Highest projected median (tournament score)',
  p90: 'Highest ceiling — best boom-week upside at this position',
};

/** Renders one badge per scenario the player leads — a single player can
 *  top more than one (e.g. p50 + p90), which the combined badge makes explicit
 *  instead of implying it's only the median pick. */
function ScenarioTag({ labels }: { labels: ('p10' | 'p50' | 'p90')[] }) {
  const multi = labels.length > 1;
  const style = multi
    ? 'border-accent/50 text-accent'
    : labels[0] === 'p10'
      ? 'border-info/40 text-info'
      : labels[0] === 'p90'
        ? 'border-positive/40 text-positive'
        : 'border-default text-muted';
  const title = labels.map((l) => `${l.toUpperCase()}: ${SCENARIO_TITLE[l]}`).join(' · ');
  return (
    <Tooltip text={title}>
      <span
        className={`shrink-0 rounded border px-1 py-0.5 text-center text-[0.6rem] font-semibold uppercase tabular-nums tracking-wide ${style}`}
      >
        {labels.join('+')}
      </span>
    </Tooltip>
  );
}

function RecRow({ rec, scenario }: { rec: Rec; scenario?: 'p10' | 'p50' | 'p90' }) {
  const { player, tags } = rec;
  const points = player.projection
    ? scenario
      ? player.projection.points[scenario]
      : player.projection.tournamentScore
    : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <span
        className={`inline-block shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase leading-none tracking-wide ${POS_BADGE[player.position]}`}
      >
        {player.position}
      </span>
      <span className="truncate font-medium text-primary" title={player.fullName}>
        {player.name}
      </span>
      <span className="shrink-0 text-xs text-muted">{player.team}</span>
      {points !== null && (
        <span className="shrink-0 text-xs tabular-nums text-secondary">
          {points.toFixed(0)} · T{player.projection!.tier}
        </span>
      )}
      {tags.map((tag) => (
        <Tooltip
          key={tag}
          text={
            tag === 'CS corr'
              ? 'Same-club G + D: their clean-sheet points are the same event'
              : tag.endsWith('left')
                ? 'Tier scarcity — few players of this tier left on the board'
                : `Would be your ${tag.split(' ')[0]} player from this club — correlated outcomes`
          }
        >
          <span
            className={`shrink-0 rounded border px-1 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${
              tag === 'CS corr' || tag.endsWith('left') ? 'border-negative/50 text-negative' : 'border-default text-muted'
            }`}
          >
            {tag}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

function posColor(pos: Position): string {
  return {
    G: 'text-pos-g',
    D: 'text-pos-d',
    MD: 'text-pos-md',
    FW: 'text-pos-fw',
  }[pos];
}
