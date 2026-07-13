import { mkdirSync, renameSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** tmp -> rename in the same directory, so readers never see a half-written file. */
export function writeFileAtomic(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, content, { encoding: 'utf8' }); // Node writes BOM-less UTF-8
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true }); // never leave a stray tmp behind
    throw err;
  }
}

export function readJson<T>(path: string): T {
  // Strip a BOM if a PS-written file ever grows one; harness output never has one.
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  return JSON.parse(text) as T;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n');
}

export function appendJsonl(path: string, value: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(value) + '\n', { encoding: 'utf8' });
}
