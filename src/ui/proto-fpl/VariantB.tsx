// Variant B: a single dense table of all 15; per-row columns for EP, 5GW EP, fixture, captain radio, and best swap inline.
import { useState } from 'react';
import { bestMoves, fdr, posCls, type Data } from './data.js';

export function VariantB({ d }: { d: Data }) {
  const [cap, setCap] = useState(d.captain.id);
  const [vice, setVice] = useState(d.vice.id);
  const moves = bestMoves(d, 200);
  const rows = [...d.xi.map((p) => ({ p, role: 'XI' })), ...d.bench.map((p, i) => ({ p, role: i === 0 ? 'GK' : `B${i}` }))];
  return (
    <div className="p-3">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="border-b border-strong text-left font-condensed text-xs uppercase text-secondary">
            <th className="px-2 py-1">Slot</th><th>Pos</th><th>Player</th><th>Opp</th><th className="text-right">EP</th><th className="text-right">Floor–Ceil</th>
            <th className="text-right">5GW</th><th className="text-center">C</th><th className="text-center">V</th><th className="px-2">Best swap (same pos, ≤ bank)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, role }) => {
            const m = moves.find((x) => x.out.id === p.id);
            return (
              <tr key={p.id} className={`border-b border-default hover:bg-surface-hover ${role !== 'XI' ? 'text-secondary' : ''}`}>
                <td className="px-2 py-1 text-xs text-muted">{role}</td>
                <td className={posCls(p.pos)}>{p.pos}</td>
                <td className="font-semibold">{p.name} <span className="text-xs text-muted">{p.team} £{p.price}</span>{p.news && <span className="ml-1 text-xs text-negative">⚠</span>}</td>
                <td className={fdr(p.diff)}>{p.opp}</td>
                <td className="text-right font-condensed font-bold">{p.ep1.toFixed(1)}</td>
                <td className="text-right text-muted">{p.floor}–{p.ceil}</td>
                <td className="text-right">{p.ep5.toFixed(1)}</td>
                <td className="text-center"><input type="radio" checked={cap === p.id} onChange={() => setCap(p.id)} /></td>
                <td className="text-center"><input type="radio" checked={vice === p.id} onChange={() => setVice(p.id)} /></td>
                <td className="px-2 text-xs">{m && m.gain5 > 0 ? <><span className="text-positive">{m.inn.name}</span> <span className="text-muted">£{m.inn.price}</span> <span className="font-bold text-accent">+{m.gain5}</span></> : <span className="text-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
