/**
 * Opens the local-first store. On the web that's real SQLite compiled to WASM, persisted via the OPFS
 * `opfs-sahpool` VFS (synchronous, and it avoids the COOP/COEP cross-origin-isolation headers the older
 * OPFS VFS needs). If SQLite/OPFS isn't available (older browser, private mode), it falls back to a
 * localStorage-backed store with the same interface. Opened once per tab (cached promise).
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { LocalStorageLocalStore, SqliteLocalStore, type LocalStore, type SqliteHandle } from "./LocalStore";

const DB_FILE = "/workoutlogger.sqlite";

let cached: Promise<LocalStore> | null = null;

/** Resolve the single local store for this tab (SQLite-WASM/OPFS, else localStorage fallback). */
export function openLocalStore(): Promise<LocalStore> {
  if (!cached) cached = create();
  return cached;
}

async function create(): Promise<LocalStore> {
  try {
    const sqlite3 = await sqlite3InitModule();
    // installOpfsSAHPoolVfs is absent if the runtime can't back OPFS (no SharedArrayBuffer/OPFS support).
    if (typeof sqlite3.installOpfsSAHPoolVfs !== "function") throw new Error("OPFS SAHPool VFS unavailable");
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "workoutlogger-opfs" });
    const db = new pool.OpfsSAHPoolDb(DB_FILE) as unknown as SqliteHandle;
    return new SqliteLocalStore(db);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[local] SQLite/OPFS unavailable — using localStorage fallback:", err);
    return new LocalStorageLocalStore();
  }
}
