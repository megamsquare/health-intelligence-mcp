interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();

  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  increment(key: K, ttlMs: number): number {
    const current = this.get(key);
    const next = typeof current === 'number' ? (current as number) + 1 : 1;
    this.map.set(key, { value: next as unknown as V, expiresAt: Date.now() + ttlMs });
    return next;
  }
}
