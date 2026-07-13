/**
 * Extract the stage-contract JSON object from an agent's final message.
 * Agents are instructed to END the reply with bare JSON, but they sometimes
 * wrap it in a code fence or lead with prose — accept all three.
 *
 * The LAST parseable object wins, matching the contract ("end your reply
 * with...") — taking the first would let quoted repo content or an early
 * example forge the stage output (review finding, 2026-07-10).
 */
export function extractStageJson(text: string): unknown | undefined {
  const trimmed = text.trim();

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  let last: unknown | undefined;

  const fences = trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g);
  for (const fence of fences) {
    const fenced = tryParse((fence[1] ?? '').trim());
    if (fenced !== undefined) last = fenced;
  }

  let from = 0;
  while (true) {
    const start = trimmed.indexOf('{', from);
    if (start === -1) break;
    const balanced = sliceBalanced(trimmed, start);
    if (balanced) {
      const embedded = tryParse(balanced);
      if (embedded !== undefined) {
        last = embedded;
        from = start + balanced.length;
        continue;
      }
    }
    from = start + 1;
  }
  return last;
}

function tryParse(text: string): unknown | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Slice a balanced {...} starting at `start`, respecting strings/escapes. */
function sliceBalanced(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
