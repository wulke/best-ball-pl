// Variant A: pitch layout (XI by line) + bench strip; right rail = captain ranking + transfer shortlist.
import { useState } from 'react';
import { bestMoves, fdr, posCls, type Data, type P } from './data.js';

const Card = ({ p, cap, vice }: { p: P; cap: boolean; vice: boolean }) => (
  <div className="relative w-24 rounded border border-default bg-surface px-2 py-1 text-center">
    {(cap || vice) && <span className="absolute -right-1 -top-1 rounded bg-accent px-1 text-[10px] font-bold text-accent-fg">{cap ? 'C' : 'V'}</span>}
    <div className={`truncate text-xs font-semibold ${posCls(p.pos)}`}>{p.name}</div>
    <div className="font-condensed text-lg font-bold tabular-nums">{p.ep1.toFixed(1)}</div>
    <div className={`text-[10px] tabular-nums ${fdr(p.diff)}`}>{p.opp}</div>
  </div>
);

export function VariantA({ d }: { d: Data }) {
  const [cap, setCap] = useState(d.captain.id);
  const lines = (['FW', 'MD', 'D', 'G'] as const).map((k) => d.xi.filter((p) => p.pos === k));
  const caps = [...d.xi].sort((a, b) => b.ep1 - a.ep1).slice(0, 5);
  const moves = bestMoves(d);
  const total = d.xi.reduce((s, p) => s + p.ep1 * (p.id === cap ? 2 : 1), 0);
  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[1fr_340px]">
      <section className="rounded-md border border-default bg-surface-raised p-3">
        <div className="mb-2 flex justify-between font-condensed text-sm uppercase text-secondary">
          <span>Starting XI</span><span className="tabular-nums text-accent">Projected {total.toFixed(1)} pts</span>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="flex justify-center gap-2">{l.map((p) => <Card key={p.id} p={p} cap={p.id === cap} vice={p.id === d.vice.id} />)}</div>
          ))}
        </div>
        <div className="mt-4 border-t border-default pt-2">
          <div className="mb-1 font-condensed text-xs uppercase text-muted">Bench (auto-sub order →)</div>
          <div className="flex justify-center gap-2">{d.bench.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1"><span className="text-xs text-muted">{i === 0 ? 'GK' : i}</span><Card p={p} cap={false} vice={false} /></div>
          ))}</div>
        </div>
      </section>
      <aside className="space-y-3">
        <section className="rounded-md border border-default bg-surface">
          <h2 className="border-b border-default px-3 py-2 font-condensed text-sm uppercase text-secondary">Captain</h2>
          {caps.map((p) => (
            <button key={p.id} onClick={() => setCap(p.id)} className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-surface-hover ${cap === p.id ? 'bg-surface-hover' : ''}`}>
              <span className={`w-6 text-xs ${posCls(p.pos)}`}>{p.pos}</span><span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-muted tabular-nums">{p.floor}–{p.ceil}</span>
              <span className="w-10 text-right font-condensed font-bold tabular-nums">{p.ep1.toFixed(1)}</span>
            </button>
          ))}
        </section>
        <section className="rounded-md border border-default bg-surface">
          <h2 className="border-b border-default px-3 py-2 font-condensed text-sm uppercase text-secondary">Transfers · {d.ft} FT · £{d.bank}m</h2>
          {moves.map((m, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1 text-sm hover:bg-surface-hover">
              <span className="flex-1 truncate text-negative">{m.out.name}</span><span className="text-muted">→</span>
              <span className="flex-1 truncate text-positive">{m.inn.name}</span>
              <span className="font-condensed font-bold tabular-nums text-accent">+{m.gain5}</span>
            </div>
          ))}
          <p className="px-3 py-1 text-[10px] text-muted">+ = 5-GW EP gain, before any −4 hit</p>
        </section>
      </aside>
    </div>
  );
}
