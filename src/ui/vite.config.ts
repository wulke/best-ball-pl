import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(uiRoot, '../..');
const snapshotSourcePath = path.join(repoRoot, 'data/snapshot.json');
const oddsSourcePath = path.join(repoRoot, 'data/odds');

export const SNAPSHOT_MISSING_MESSAGE =
  'data/snapshot.json not found — run npm run etl first';

/** Serve data/snapshot.json in dev mode so the runtime fetch succeeds. */
function createSnapshotServePlugin(): Plugin {
  return {
    name: 'serve-snapshot',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';

        const oddsMatch = url.match(/\/data\/odds\/([a-z0-9-]+)\.json$/);
        if (oddsMatch) {
          const sourcePath = path.join(oddsSourcePath, `${oddsMatch[1]}.json`);
          if (!fs.existsSync(sourcePath)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(sourcePath, 'utf8'));
          return;
        }

        if (!url.endsWith('/data/snapshot.json')) {
          next();
          return;
        }

        if (!fs.existsSync(snapshotSourcePath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end(SNAPSHOT_MISSING_MESSAGE);
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(snapshotSourcePath, 'utf8'));
      });
    },
    writeBundle(options) {
      const outDir = options.dir;

      if (!outDir) {
        return;
      }

      if (!fs.existsSync(snapshotSourcePath)) {
        throw new Error(SNAPSHOT_MISSING_MESSAGE);
      }

      const destinationPath = path.join(outDir, 'data/snapshot.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(snapshotSourcePath, destinationPath);
      if (fs.existsSync(oddsSourcePath)) {
        fs.cpSync(oddsSourcePath, path.join(outDir, 'data/odds'), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: uiRoot,
  base: '/best-ball-pl/',
  plugins: [react(), createSnapshotServePlugin()],
  build: {
    outDir: path.resolve(uiRoot, '../../dist/ui'),
    emptyOutDir: true,
  },
});
