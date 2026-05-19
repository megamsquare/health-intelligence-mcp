// To swap in Redis: implement Cache with ioredis and replace the singleton below.
// Key differences: set() needs EX (seconds), increment() maps to INCR + EXPIRE,
// and all methods become async-native rather than sync-wrapped.

import { TtlCache } from '../lib/cache.js';

export interface Cache {
  get<V>(key: string): V | undefined;
  set<V>(key: string, value: V, ttlSeconds: number): void;
  increment(key: string, ttlSeconds: number): number;
  delete(key: string): void;
}

export class AppCache implements Cache {
  // ttlMs=0 — AppCache always passes per-call TTLs so the constructor default is unused.
  private readonly store = new TtlCache<string, unknown>(0);

  get<V>(key: string): V | undefined {
    return this.store.get(key) as V | undefined;
  }

  set<V>(key: string, value: V, ttlSeconds: number): void {
    this.store.set(key, value, ttlSeconds * 1000);
  }

  increment(key: string, ttlSeconds: number): number {
    return this.store.increment(key, ttlSeconds * 1000);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

export const cache: Cache = new AppCache();
