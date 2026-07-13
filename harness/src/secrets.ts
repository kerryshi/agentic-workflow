/**
 * Conservative secret scrub for agent-output tails that land in git-committed
 * run records (PRD FR7). Masks the value portion of credential-looking lines;
 * never blocks the write.
 */
const LINE_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|secret|token|password|passwd|authorization|bearer|credential)s?\b\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|pk|ghp|gho|xox[bap])-[A-Za-z0-9_-]{10,}\b/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of LINE_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const head = match.slice(0, Math.min(12, match.indexOf(match.includes(':') ? ':' : '=') + 1));
      return `${head} [REDACTED]`;
    });
  }
  return out;
}
