import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Atomically claim a run/case directory, returning the id actually won.
 *
 * The directory IS the lock: `mkdir` WITHOUT `recursive` throws EEXIST when the name is
 * taken, so exactly one racer can win a given id. This is what `new_run.ps1` did
 * (`New-Item -ItemType Directory` with no `-Force`).
 *
 * It must NOT be written as existsSync() -> pick a suffix -> ensureDir(). `ensureDir` is
 * mkdir -p, which SUCCEEDS on an existing directory, so two processes starting the same task
 * in the same minute both see "free", both pick the same id, and the second silently
 * overwrites the first's run.json. That is the CASE-0005 class; CASE-0018 records the Node
 * case-port reintroducing it, and it was still live in `createRun` until 2026-07-13.
 *
 * Deliberately imports only node builtins: that keeps it loadable by a bare `node` child
 * process (Node strips types, but does not remap the TS `./x.js` import convention to `.ts`),
 * which is the only way to regression-test a cross-process race honestly.
 */
export function claimDir(parentDir: string, baseId: string, maxAttempts = 500): string {
  mkdirSync(parentDir, { recursive: true }); // the PARENT may be created concurrently; that's fine
  let id = baseId;
  for (let n = 2; ; n++) {
    try {
      mkdirSync(join(parentDir, id)); // atomic claim — throws EEXIST if someone beat us here
      return id;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (n > maxAttempts) {
        throw new Error(`could not allocate a unique id under ${parentDir} (base: ${baseId})`);
      }
      id = `${baseId}-${n}`;
    }
  }
}
