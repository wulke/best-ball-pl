// Variant C: a "decision stack" — three ordered questions (Captain → Transfer → Lineup) each with a recommendation
// and the reasoning (net of hit), top to bottom, acting as a weekly checklist.
import { bestMoves, fdr, posCls, type Data } from './data.js';

const Sec = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="rounded-md border border-default bg-surface">
    <h2 className="flex items-center gap-2 border-b border-default px-3 py-2 font-condensed text-sm uppercase text-secondary">
      <span className="rounded bg-accent px-1.5 text-accent-fg">{n}</span>{title}
    </h2>
    <div className="px-3 py-2">{children}</div>
  </section>
);

export function VariantC({ d }: { d: Data }) {
  const caps = [...d.xi].sort((a, b) => b.ep1 - a.ep1).slice(0, 3);
  const moves = bestMoves(d, 40);
  const one = moves.slice(0, 3);
  const twoOut = new Set<string>(), twoIn = new Set<string>();
  const two = moves.filter((m) => { if (twoOut.has(m.out.id) || twoIn.has(m.inn.id)) return false; twoOut.add(m.out.id); twoIn.add(m.inn.id); return true; }).slice(0, 2);
  const twoGain = two.reduce((s, m) => s + m.gain5, 0) - 4;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3">
      <Sec n={1} title="Captain">
        <div className="grid grid-cols-3 gap-2">
          {caps.map((p, i) => (
            <div key={p.id} className={`rounded border px-2 py-2 ${i === 0 ? 'border-accent' : 'border-default'}`}>
              <div className={`text-xs ${posCls(p.pos)}`}>{p.pos} · {p.team}</div>
              <div className="font-semibold">{p.name}{i === 0 && <span className="ml-1 text-xs text-accent">pick</span>}</div>
              <div className="font-condensed text-2xl font-bold tabular-nums">{(p.ep1 * 2).toFixed(1)}<span className="text-xs text-muted"> as C</span></div>
              <div className={`text-xs tabular-nums ${fdr(p.diff)}`}>{p.opp} · {p.floor}–{p.ceil} · own {p.own}%</div>
            </div>
          ))}
        </div>
      </Sec>
      <Sec n={2} title={`Transfers — ${d.ft} free, £${d.bank}m bank`}>
        <div className="text-xs text-muted">Best single move (free)</div>
        {one.map((m, i) => (
          <div key={i} className="flex items-center gap-2 border-b border-default py-1 text-sm tabular-nums last:border-0">
            <span className="flex-1 text-negative">{m.out.name} <span className="text-muted">£{m.out.price}</span></span>→
            <span className="flex-1 text-positive">{m.inn.name} <span className="text-muted">£{m.inn.price}</span></span>
            <span className="text-xs text-muted">now {m.gain1 >= 0 ? '+' : ''}{m.gain1}</span><span className="w-16 text-right font-bold text-accent">+{m.gain5} /5GW</span>
          </div>
        ))}
        <div className="mt-2 text-xs text-muted">Two moves (one −4 hit)</div>
        <div className="text-sm tabular-nums">{two.map((m) => `${m.out.name}→${m.inn.name}`).join(' + ')} <span className={`ml-2 font-bold ${twoGain > one[0]!.gain5 ? 'text-positive' : 'text-negative'}`}>net {twoGain.toFixed(1)}</span> <span className="text-xs text-muted">vs {one[0]!.gain5} for one free move</span></div>
      </Sec>
      <Sec n={3} title="Lineup & bench order">
        <div className="text-sm">XI: {d.xi.map((p) => <span key={p.id} className={`mr-2 ${posCls(p.pos)}`}>{p.name}</span>)}</div>
        <div className="mt-1 text-sm text-secondary">Bench: {d.bench.map((p, i) => <span key={p.id} className="mr-2">{i === 0 ? 'GK' : i}. {p.name} <span className="text-xs text-muted tabular-nums">{p.ep1.toFixed(1)}</span></span>)}</div>
        <div className="mt-1 text-xs text-muted">Flags: {[...d.xi, ...d.bench].filter((p) => p.news).map((p) => `${p.name} (${p.news})`).join('; ') || 'no injury flags'}</div>
      </Sec>
    </div>
  );
}
