import { mkdirSync, rmdirSync, statSync } from 'node:fs';

/**
 * Cross-process mutex via atomic mkdir — the Node analogue of the PS
 * scripts' Invoke-WithFileLock. The v2.2 review reproduced CASE-0005
 * (duplicate case ids, 14/15 races) after the port dropped the lock;
 * every read-modify-write on shared records goes through here now.
 */

const RETRY_MS = 25;
const STALE_MS = 30_000;
const ACQUIRE_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withDirLock<T>(lockPath: string, body: () => T | Promise<T>): Promise<T> {
  const lockDir = `${lockPath}.lock`;
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lockDir); // atomic claim
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // A crashed holder leaves a stale lock — break it after STALE_MS.
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > STALE_MS) {
          rmdirSync(lockDir);
          continue;
        }
      } catch {
        continue; // holder released between our stat and now — retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error(`could not acquire lock ${lockDir} within ${ACQUIRE_TIMEOUT_MS}ms — stale holder?`);
      }
      await sleep(RETRY_MS);
    }
  }
  try {
    return await body();
  } finally {
    try {
      rmdirSync(lockDir);
    } catch {
      /* already broken as stale by a waiter — nothing to release */
    }
  }
}
