import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(repoRoot, 'data/snapshot.json');

export const SNAPSHOT_MISSING_MESSAGE =
  'data/snapshot.json not found — run npm run etl first';

/**
 * ETL entry point. Skeleton state: writes a placeholder snapshot so the UI and
 * static build have a valid contract to compile against.
 *
 * The real FPL pull lands with the ETL slice (blocked on the FPL API research
 * ticket — see the wayfinder map). Sources are added one module per slice under
 * src/etl/ and orchestrated here.
 */
async function main() {
  const snapshot = {
    generated_at: new Date().toISOString(),
    players: [],
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log('[ETL] Placeholder snapshot written to data/snapshot.json');
  console.log('[ETL] Real FPL pull pending — see the wayfinder map\'s FPL ETL ticket.');
}

main().catch((err) => {
  console.error('[ETL] Failed:', err);
  process.exit(1);
});
