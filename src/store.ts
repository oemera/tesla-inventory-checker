import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Match } from "./domain.js";

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        profile_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_price_eur REAL,
        vehicle_json TEXT NOT NULL,
        PRIMARY KEY (profile_id, vehicle_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS notifications (
        profile_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, vehicle_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS poll_runs (
        id INTEGER PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        success INTEGER,
        error TEXT
      ) STRICT;
    `);
  }

  close(): void {
    this.db.close();
  }

  hasSeen(profileId: string, vehicleId: string): boolean {
    return this.db.prepare("SELECT 1 AS found FROM matches WHERE profile_id = ? AND vehicle_id = ?").get(profileId, vehicleId) !== undefined;
  }

  observe(match: Match, now = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO matches (profile_id, vehicle_id, first_seen_at, last_seen_at, last_price_eur, vehicle_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, vehicle_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        last_price_eur = excluded.last_price_eur,
        vehicle_json = excluded.vehicle_json
    `).run(match.profile.id, match.vehicle.id, now, now, match.vehicle.priceEur ?? null, JSON.stringify(match.vehicle));
  }

  hasNotified(profileId: string, vehicleId: string): boolean {
    return this.db.prepare("SELECT 1 AS found FROM notifications WHERE profile_id = ? AND vehicle_id = ?").get(profileId, vehicleId) !== undefined;
  }

  recordNotification(match: Match, now = new Date().toISOString()): void {
    this.db.prepare("INSERT OR IGNORE INTO notifications (profile_id, vehicle_id, sent_at) VALUES (?, ?, ?)")
      .run(match.profile.id, match.vehicle.id, now);
  }

  isBaselineComplete(profileId: string): boolean {
    return this.db.prepare("SELECT 1 AS found FROM metadata WHERE key = ?").get(`baseline:${profileId}`) !== undefined;
  }

  markBaselineComplete(profileId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)").run(`baseline:${profileId}`, new Date().toISOString());
  }

  startPoll(now = new Date().toISOString()): number {
    const result = this.db.prepare("INSERT INTO poll_runs (started_at) VALUES (?)").run(now);
    return Number(result.lastInsertRowid);
  }

  finishPoll(id: number, success: boolean, error?: string, now = new Date().toISOString()): void {
    this.db.prepare("UPDATE poll_runs SET finished_at = ?, success = ?, error = ? WHERE id = ?")
      .run(now, success ? 1 : 0, error ?? null, id);
  }

  lastSuccessfulPoll(): string | undefined {
    const row = this.db.prepare("SELECT finished_at FROM poll_runs WHERE success = 1 ORDER BY id DESC LIMIT 1").get() as { finished_at?: string } | undefined;
    return row?.finished_at;
  }
}
