// PROTOTYPE data: mock squad + crude EP from snapshot. Throwaway.
export interface P {
  id: string; name: string; pos: 'G' | 'D' | 'MD' | 'FW'; team: string; price: number;
  ep1: number; ep5: number; floor: number; ceil: number; opp: string; diff: number; own: number; news: string; status: string;
}
export interface Data {
  gw: number; ft: number; bank: number; value: number;
  xi: P[]; bench: P[]; captain: P; vice: P; pool: P[];
}
const APP: Record<string, number> = { G: 0, D: 0, MD: 0, FW: 0 };
const GOAL = { G: 10, D: 6, MD: 5, FW: 4 } as const;
const CS = { G: 4, D: 4, MD: 1, FW: 0 } as const;

export function buildData(snap: any): Data {
  const gw = 7;
  const fx: any[] = snap.fixtures.filter((f: any) => f.event >= gw && f.event < gw + 5);
  const ps: P[] = [];
  for (const p of snap.players) {
    const st = p.projection?.statline;
    if (!st || p.status === 'u' || p.status === 'i') continue;
    const m = Math.max(st.matches, 1);
    const base = 2 * Math.min(1, st.minutes / (m * 90) + 0.1) + (st.goals / m) * GOAL[p.position as 'G'] + (st.assists / m) * 3 + (st.cleanSheets / m) * CS[p.position as 'G'] + (st.saves / m) / 3;
    const mine = fx.filter((f) => f.home === p.team || f.away === p.team);
    const mk = (f: any) => {
      const d = f.home === p.team ? f.homeDifficulty : f.awayDifficulty;
      return { ep: base * (1.3 - 0.1 * d), d, opp: (f.home === p.team ? f.away.toLowerCase() : f.away === p.team ? f.home.toUpperCase() : '') };
    };
    const next = mine.find((f) => f.event === gw);
    const n = next ? mk(next) : { ep: 0, d: 3, opp: '—' };
    const ep5 = mine.reduce((s, f) => s + mk(f).ep, 0);
    ps.push({
      id: p.id, name: p.name, pos: p.position, team: p.team, price: p.price,
      ep1: +n.ep.toFixed(1), ep5: +ep5.toFixed(1), floor: +(n.ep * 0.4).toFixed(1), ceil: +(n.ep * 2.2).toFixed(1),
      opp: next ? (next.home === p.team ? next.away.toUpperCase() + '(H)' : next.home.toUpperCase() + '(A)') : '—',
      diff: n.d, own: Math.round(2 + Math.min(60, p.price * 3.2 * (base / 5)) ), news: p.news, status: p.status,
    });
  }
  // greedy mock squad: 2/5/5/3, <=3 per club, ~£100m total (slightly under budget, leave bank)
  const need: Record<string, number> = { G: 2, D: 5, MD: 5, FW: 3 };
  const cnt: Record<string, number> = {};
  const squad: P[] = [];
  let spend = 0;
  const bySlot = [...ps].sort((a, b) => b.ep5 / b.price ** 0.6 - a.ep5 / a.price ** 0.6);
  for (const p of bySlot) {
    if (need[p.pos]! <= 0 || (cnt[p.team] ?? 0) >= 3 || spend + p.price > 99.2 - (squad.length < 12 ? 0 : 0)) continue;
    squad.push(p); need[p.pos]!--; cnt[p.team] = (cnt[p.team] ?? 0) + 1; spend += p.price;
  }
  const sorted = [...squad].sort((a, b) => b.ep1 - a.ep1);
  const gks = sorted.filter((p) => p.pos === 'G');
  const out = sorted.filter((p) => p.pos !== 'G');
  const xi: P[] = [gks[0]!];
  const minPos: Record<string, number> = { D: 3, MD: 2, FW: 1 };
  for (const k of Object.keys(minPos)) xi.push(...out.filter((p) => p.pos === k).slice(0, minPos[k]));
  for (const p of out) if (xi.length < 11 && !xi.includes(p)) xi.push(p);
  const bench = [gks[1]!, ...out.filter((p) => !xi.includes(p))];
  const cap = [...xi].sort((a, b) => b.ep1 - a.ep1);
  const pool = ps.filter((p) => !squad.includes(p));
  return { gw, ft: 1, bank: +(100 - spend).toFixed(1), value: +spend.toFixed(1), xi, bench, captain: cap[0]!, vice: cap[1]!, pool };
}

export const POS_ORDER = ['G', 'D', 'MD', 'FW'] as const;
export const posCls = (p: string) => ({ G: 'text-pos-g', D: 'text-pos-d', MD: 'text-pos-md', FW: 'text-pos-fw' } as any)[p];
export const fdr = (d: number) => (d <= 2 ? 'text-positive' : d >= 4 ? 'text-negative' : 'text-secondary');

export interface Move { out: P; inn: P; gain1: number; gain5: number; cost: number; }
/** best single-player swaps same position, affordable within bank */
export function bestMoves(d: Data, n = 6): Move[] {
  const all = [...d.xi, ...d.bench];
  const mv: Move[] = [];
  for (const o of all) for (const i of d.pool) {
    if (i.pos !== o.pos || i.price - o.price > d.bank + 1e-9) continue;
    if (all.filter((p) => p.team === i.team && p !== o).length >= 3) continue;
    mv.push({ out: o, inn: i, gain1: +(i.ep1 - o.ep1).toFixed(1), gain5: +(i.ep5 - o.ep5).toFixed(1), cost: +(i.price - o.price).toFixed(1) });
  }
  return mv.sort((a, b) => b.gain5 - a.gain5).slice(0, n);
}
void APP;
