const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|credential|cookie/i;

export function redactSecrets<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null || typeof value !== 'object') {
    return typeof value === 'string' ? redactString(value) : value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child, seen);
  }
  return out;
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|api[_-]?key)=([^&\s]+)/gi, '$1=[REDACTED]');
}
