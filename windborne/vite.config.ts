import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-server save endpoint for the placement tool (PRD §7.4): the editor
 * POSTs the whole level JSON here and it lands directly in
 * `src/levels/dream-01.json`, which then hot-reloads and lives in git.
 * "Saving writes to disk, not to a download."
 *
 * The path is fixed server-side — the client never chooses where to
 * write. `configureServer` only exists on the dev server, so none of
 * this ships in a production build.
 */
function levelSaveEndpoint(): Plugin {
  const levelPath = fileURLToPath(new URL('./src/levels/dream-01.json', import.meta.url));
  return {
    name: 'windborne-level-save',
    configureServer(server) {
      server.middlewares.use('/__windborne/save-level', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          void (async () => {
            try {
              // Round-trip through parse so we never write malformed JSON,
              // and pretty-print so the file stays hand-editable and diffs
              // cleanly in git.
              const parsed: unknown = JSON.parse(body);
              await writeFile(levelPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
              res.statusCode = 200;
              res.end('saved');
            } catch (error) {
              res.statusCode = 400;
              res.end(`not saved: ${error instanceof Error ? error.message : 'invalid JSON'}`);
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves project sites from /<repo-name>/. "windborne" is the
  // working title and current directory name — update this if the repo the
  // site deploys from ends up named differently.
  base: '/windborne/',
  plugins: [levelSaveEndpoint()],
});
