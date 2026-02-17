export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      out[key] = value.length > 0 ? value : 'true';
      continue;
    }

    const value = argv[i + 1];
    out[trimmed] = value && !value.startsWith('--') ? value : 'true';
  }
  return out;
}
