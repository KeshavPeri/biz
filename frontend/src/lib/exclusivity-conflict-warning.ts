export type ConflictWarning = {
  version: 1;
  digest: string;
  conflicts: { brand: string; category: string; expiry: string }[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid conflict warning');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|')) throw Error('Invalid conflict warning');
  return row;
}

export function campaignCategory(value: string): string {
  const display = value.trim();
  if (!display || [...display].length > 200 || UNSAFE.test(display)) {
    throw Error('Enter a category of 1–200 characters without control or direction characters.');
  }
  return display;
}

function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || [...value].length > max || value !== value.trim() || UNSAFE.test(value)) {
    throw Error('Invalid conflict warning');
  }
  return value;
}

export function parseConflictWarning(value: unknown): ConflictWarning {
  const row = object(value, ['version', 'digest', 'conflicts']);
  if (row.version !== 1 || typeof row.digest !== 'string' || !DIGEST.test(row.digest)
      || !Array.isArray(row.conflicts) || row.conflicts.length < 1 || row.conflicts.length > 50) {
    throw Error('Invalid conflict warning');
  }
  const conflicts = row.conflicts.map((item) => {
    const entry = object(item, ['brand', 'category', 'expiry']);
    const expiry = safeText(entry.expiry, 10);
    if (!DATE.test(expiry) || new Date(`${expiry}T00:00:00.000Z`).toISOString().slice(0, 10) !== expiry) {
      throw Error('Invalid conflict warning');
    }
    return { brand: safeText(entry.brand, 160), category: safeText(entry.category, 200), expiry };
  });
  return { version: 1, digest: row.digest, conflicts };
}

export class ConflictWarningFence {
  private context = '';
  private generation = 0;
  switchContext(context: string) {
    if (context !== this.context) { this.context = context; this.generation += 1; }
  }
  begin(context: string) {
    this.switchContext(context); this.generation += 1;
    return { context, generation: this.generation };
  }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) {
    return ticket.context === this.context && ticket.generation === this.generation;
  }
}

export async function runConnectWithSessionFence<T>(
  fence: ConflictWarningFence,
  context: string,
  readAccount: () => Promise<string | null | undefined>,
  send: () => Promise<T>,
): Promise<{ state: 'stale' } | { state: 'signed-out' } | { state: 'result'; result: T }> {
  const ticket = fence.begin(context);
  const account = await readAccount();
  if (!fence.isCurrent(ticket)) return { state: 'stale' };
  if (!account) return { state: 'signed-out' };

  const result = await send();
  if (!fence.isCurrent(ticket)) return { state: 'stale' };
  const currentAccount = await readAccount();
  if (!fence.isCurrent(ticket) || currentAccount !== account) return { state: 'stale' };
  return { state: 'result', result };
}
