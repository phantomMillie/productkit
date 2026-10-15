import { createHash } from 'node:crypto';

/**
 * Recursively sorts object keys so the same data always serializes the same
 * way, regardless of insertion order. Arrays keep their order — order is
 * meaningful there (e.g. decomposition sequence).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical JSON: same data in, same string out, independent of key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Trims every string in a value, recursively. The artifact schemas trim their
 * text fields while parsing, so hashing untrimmed input and then parsing it
 * produced a content-hash mismatch for any value with leading or trailing
 * whitespace (for example a YAML `|` block). create* functions hash and parse
 * the trimmed value instead.
 */
export function trimDeep<T>(value: T): T {
  if (typeof value === 'string') return value.trim() as T;
  if (Array.isArray(value)) return value.map((item) => trimDeep(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimDeep(v)])) as T;
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
