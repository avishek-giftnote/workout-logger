/**
 * Local-first key/value store — the portability seam. The web build backs this with SQLite-WASM (OPFS),
 * but the SAME interface ports to `expo-sqlite` (mobile) / `better-sqlite3` (desktop) later with no
 * call-site changes. Each value carries an `updatedAt` (epoch ms) so server sync can do last-write-wins.
 *
 * Reads/writes are SYNCHRONOUS — the opfs-sahpool VFS is a synchronous VFS, so only opening the DB is
 * async (see openLocalStore in sqlite.ts). A LocalStorageLocalStore fallback keeps the app working where
 * OPFS/SQLite isn't available.
 */
export interface LocalStore {
  get(key: string): string | null;
  set(key: string, value: string, updatedAt: number): void;
  remove(key: string): void;
  all(): Map<string, { value: string; updatedAt: number }>;
}

/** The subset of the sqlite-wasm oo1 Database API we use (so both OpfsSAHPoolDb and an in-memory
 *  `oo1.DB(':memory:')` — used in tests — satisfy it). */
export interface SqliteHandle {
  exec(opts: { sql: string; bind?: unknown[] }): unknown;
  selectValue(sql: string, bind?: unknown[]): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
}

const DDL = "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL)";

export class SqliteLocalStore implements LocalStore {
  constructor(private db: SqliteHandle) {
    db.exec({ sql: DDL });
  }
  get(key: string): string | null {
    const v = this.db.selectValue("SELECT value FROM kv WHERE key=?", [key]);
    return v == null ? null : String(v);
  }
  set(key: string, value: string, updatedAt: number): void {
    this.db.exec({
      sql: "INSERT INTO kv(key,value,updatedAt) VALUES(?,?,?) " +
           "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt",
      bind: [key, value, updatedAt],
    });
  }
  remove(key: string): void {
    this.db.exec({ sql: "DELETE FROM kv WHERE key=?", bind: [key] });
  }
  all(): Map<string, { value: string; updatedAt: number }> {
    const out = new Map<string, { value: string; updatedAt: number }>();
    for (const r of this.db.selectObjects("SELECT key,value,updatedAt FROM kv"))
      out.set(String(r.key), { value: String(r.value), updatedAt: Number(r.updatedAt) });
    return out;
  }
}

/** Fallback store with the same contract, backed by localStorage (one JSON record per key). */
export class LocalStorageLocalStore implements LocalStore {
  constructor(private prefix = "wl.kv.") {}
  get(key: string): string | null {
    const raw = localStorage.getItem(this.prefix + key);
    return raw == null ? null : (JSON.parse(raw).value as string);
  }
  set(key: string, value: string, updatedAt: number): void {
    localStorage.setItem(this.prefix + key, JSON.stringify({ value, updatedAt }));
  }
  remove(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }
  all(): Map<string, { value: string; updatedAt: number }> {
    const out = new Map<string, { value: string; updatedAt: number }>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(this.prefix)) continue;
      const { value, updatedAt } = JSON.parse(localStorage.getItem(k)!);
      out.set(k.slice(this.prefix.length), { value, updatedAt });
    }
    return out;
  }
}
