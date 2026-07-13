import { pathToFileURL } from 'node:url';

const mod = await import(
  pathToFileURL('C:/Users/PC/agentic-workflow/harness/dist/adapters/codex.js')
);
const driver = new mod.CodexDriver();

const avail = await driver.available();
console.log('available():', avail);
if (!avail) process.exit(1);

const res = await driver.run(
  {
    stage: 'verify',
    prompt:
      'Reply with exactly this JSON and nothing else: {"driver":"codex","status":"LIVE"}',
    cwd: process.cwd(),
  },
  { timeoutMs: 180_000, skipPermissions: false },
);
console.log(JSON.stringify(res, null, 2));
process.exit(res.ok && res.parsed && res.parsed.status === 'LIVE' ? 0 : 1);
