// PROTOTYPE (throwaway, #246): three structurally different layouts for the FPL weekly
// decision view (lineup + captain + transfers). Mock squad built from the Oct-16 snapshot;
// EP is a crude stand-in, NOT the real FPL scorer. Switch with ?variant=A|B|C or ←/→.
import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import { buildData, type P, type Data } from './data.js';
import { VariantA } from './VariantA.js';
import { VariantB } from './VariantB.js';
import { VariantC } from './VariantC.js';

document.documentElement.setAttribute('data-theme', localStorage.getItem('bbpl-theme') ?? 'pitch');

const VARIANTS = [
  { key: 'A', name: 'Pitch + side rail' },
  { key: 'B', name: 'One dense table' },
  { key: 'C', name: 'Decision stack' },
] as const;

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [variant, setVariant] = useState(() => new URLSearchParams(location.search).get('variant') ?? 'A');
  useEffect(() => {
    fetch('data/snapshot.json').then((r) => r.json()).then((s) => setData(buildData(s)));
  }, []);
  const go = (d: number) => {
    const i = VARIANTS.findIndex((v) => v.key === variant);
    const k = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]!.key;
    setVariant(k);
    const u = new URL(location.href);
    u.searchParams.set('variant', k);
    history.replaceState(null, '', u);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const cur = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  if (!data) return <p className="p-4 text-muted">Loading…</p>;
  return (
    <div className="min-h-screen bg-app text-primary pb-16">
      <header className="flex items-baseline gap-3 border-b border-default px-3 py-2">
        <h1 className="font-condensed text-lg font-bold uppercase tracking-wide text-accent">FPL · GW{data.gw}</h1>
        <span className="text-xs text-secondary tabular-nums">
          Deadline in 3d 4h · FT {data.ft} · Bank £{data.bank.toFixed(1)}m · Squad £{data.value.toFixed(1)}m
        </span>
        <span className="ml-auto text-xs text-negative">PROTOTYPE · mock squad · crude EP</span>
      </header>
      {cur.key === 'A' && <VariantA d={data} />}
      {cur.key === 'B' && <VariantB d={data} />}
      {cur.key === 'C' && <VariantC d={data} />}
      <div className="fixed bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-strong bg-surface-raised px-4 py-2 shadow-lg">
        <button onClick={() => go(-1)} className="px-2 text-accent">←</button>
        <span className="font-condensed text-sm tabular-nums">{cur.key} · {cur.name}</span>
        <button onClick={() => go(1)} className="px-2 text-accent">→</button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
export type { P };
