import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Channel, Match, Profile } from "./domain.js";
import type { ReportConfig } from "./report-config.js";
import { REPORT_WINDOW_MS, type StockReport } from "./stock-report.js";

export interface Delivery { id: number; channel: Channel; payload: string; attempts: number }

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const existing = existsSync(path);
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 3) { this.db.close(); throw new Error("Database version is newer than this application."); }
    if (existing && version < 3) this.db.prepare("VACUUM INTO ?").run(`${path}.pre-v3-${Date.now()}.sqlite`);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      BEGIN IMMEDIATE;
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
      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY,
        profile_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('telegram', 'email')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'suppressed', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT,
        UNIQUE(profile_id, revision, vehicle_id, channel)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS stock_reports (
        id TEXT PRIMARY KEY,
        slot_date TEXT NOT NULL,
        slot_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS stock_report_deliveries (
        id INTEGER PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES stock_reports(id),
        channel TEXT NOT NULL CHECK(channel IN ('telegram', 'email')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'cancelled', 'expired')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT,
        UNIQUE(report_id, channel)
      ) STRICT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  transaction(action: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try { action(); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  queueMatches(profile: Profile, matches: Match[], notifyInitially: boolean): void {
    const rev = revision(profile);
    const baselineKey = `baseline:v2:${profile.id}:${rev}`;
    const priorRevision = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(`revision:${profile.id}`);
    const baseline = Boolean(this.db.prepare("SELECT 1 FROM metadata WHERE key = ?").get(baselineKey))
      || (!priorRevision && this.isBaselineComplete(profile.id));
    for (const match of matches) {
      const legacySeen = !priorRevision && this.isBaselineComplete(profile.id) && Boolean(this.db.prepare(
        "SELECT 1 FROM matches WHERE profile_id=? AND (vehicle_id=? OR json_extract(vehicle_json, '$.vin')=?)"
      ).get(profile.id, match.vehicle.id, match.vehicle.vin ?? match.vehicle.id));
      this.observe(match);
      const legacySent = this.db.prepare(`SELECT 1 FROM notifications n LEFT JOIN matches m
        ON m.profile_id=n.profile_id AND m.vehicle_id=n.vehicle_id
        WHERE n.profile_id=? AND (n.vehicle_id=? OR json_extract(m.vehicle_json, '$.vin')=?)`).get(profile.id, match.vehicle.id, match.vehicle.vin ?? match.vehicle.id);
      for (const channel of ["telegram", "email"] as const) {
        if (!profile.notify[channel]) continue;
        const status = legacySent || legacySeen || (!baseline && !notifyInitially) ? "suppressed" : "pending";
        this.db.prepare(`INSERT OR IGNORE INTO deliveries
          (profile_id, revision, vehicle_id, channel, payload, status) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(profile.id, rev, match.vehicle.id, channel, JSON.stringify(match), status);
      }
    }
    this.db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run(baselineKey, new Date().toISOString());
    this.db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)").run(`revision:${profile.id}`, rev);
  }

  reconcileProfiles(profiles: Profile[]): void {
    for (const row of this.db.prepare("SELECT DISTINCT profile_id, revision FROM deliveries WHERE status='pending'").all() as Array<{profile_id: string; revision: string}>) {
      if (!profiles.some((p) => p.enabled && p.id === row.profile_id && revision(p) === row.revision)) {
        this.db.prepare("UPDATE deliveries SET status='cancelled' WHERE profile_id=? AND revision=? AND status='pending'").run(row.profile_id, row.revision);
      }
    }
  }

  pending(now = Date.now()): Delivery[] {
    return this.db.prepare("SELECT id, channel, payload, attempts FROM deliveries WHERE status='pending' AND next_attempt<=? ORDER BY id LIMIT 10").all(now) as unknown as Delivery[];
  }

  delivered(id: number): void {
    this.db.prepare("UPDATE deliveries SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  retry(delivery: Delivery, now = Date.now()): void {
    const delay = Math.min(3600, 30 * 2 ** Math.min(delivery.attempts, 7));
    this.db.prepare("UPDATE deliveries SET attempts=attempts+1, next_attempt=? WHERE id=?").run(now + delay * 1000, delivery.id);
  }

  pendingCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM deliveries WHERE status='pending'").get() as {n: number}).n;
  }

  hasStockReport(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM stock_reports WHERE id=?").get(id));
  }

  queueStockReport(report: StockReport, channels: Record<Channel, boolean>): void {
    this.transaction(() => {
      const inserted = this.db.prepare("INSERT OR IGNORE INTO stock_reports (id,slot_date,slot_time,timezone,payload,expires_at) VALUES (?,?,?,?,?,?)")
        .run(report.slot.id, report.slot.date, report.slot.time, report.slot.timezone, JSON.stringify(report), report.slot.dueAt + REPORT_WINDOW_MS);
      if (!inserted.changes) return;
      // Do not deliver an older pending report after a newer report supersedes it.
      this.db.prepare("UPDATE stock_report_deliveries SET status='expired' WHERE status='pending' AND report_id IN (SELECT id FROM stock_reports WHERE expires_at<?)")
        .run(report.slot.dueAt + REPORT_WINDOW_MS);
      for (const channel of ["telegram", "email"] as const) {
        if (channels[channel]) this.db.prepare("INSERT INTO stock_report_deliveries (report_id,channel,status) VALUES (?,?,'pending')").run(report.slot.id, channel);
      }
    });
  }

  reconcileStockReports(config: ReportConfig | undefined, now = Date.now()): void {
    this.db.prepare("UPDATE stock_report_deliveries SET status='expired' WHERE status='pending' AND report_id IN (SELECT id FROM stock_reports WHERE expires_at<=?)").run(now);
    if (!config?.enabled) {
      this.db.prepare("UPDATE stock_report_deliveries SET status='cancelled' WHERE status='pending'").run();
      return;
    }
    const pending = this.db.prepare("SELECT d.id,d.channel,r.slot_time,r.timezone FROM stock_report_deliveries d JOIN stock_reports r ON r.id=d.report_id WHERE d.status='pending'")
      .all() as Array<{id: number; channel: Channel; slot_time: string; timezone: string}>;
    for (const row of pending) {
      if (!config.notify[row.channel] || row.timezone !== config.timezone || !config.times.includes(row.slot_time)) {
        this.db.prepare("UPDATE stock_report_deliveries SET status='cancelled' WHERE id=?").run(row.id);
      }
    }
  }

  pendingStockReports(now = Date.now()): Delivery[] {
    return this.db.prepare(`SELECT d.id,d.channel,r.payload,d.attempts FROM stock_report_deliveries d JOIN stock_reports r ON r.id=d.report_id
      WHERE d.status='pending' AND d.next_attempt<=? AND r.expires_at>? ORDER BY d.id LIMIT 10`).all(now, now) as unknown as Delivery[];
  }

  stockReportDelivered(id: number): void {
    this.db.prepare("UPDATE stock_report_deliveries SET status='sent',sent_at=? WHERE id=?").run(new Date().toISOString(), id);
  }

  retryStockReport(delivery: Delivery, now = Date.now()): void {
    const delay = Math.min(3600, 30 * 2 ** Math.min(delivery.attempts, 7));
    this.db.prepare("UPDATE stock_report_deliveries SET attempts=attempts+1,next_attempt=? WHERE id=?").run(now + delay * 1000, delivery.id);
  }

  heartbeat(): void {
    this.db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES ('heartbeat', ?)").run(new Date().toISOString());
  }

  lastHeartbeat(): string | undefined {
    return (this.db.prepare("SELECT value FROM metadata WHERE key='heartbeat'").get() as {value: string} | undefined)?.value;
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

export function revision(profile: Profile): string {
  return createHash("sha256").update(JSON.stringify({
    market: profile.market, model: profile.model, condition: profile.condition,
    trim: [...profile.trim ?? []].sort(), exteriorColors: [...profile.exteriorColors ?? []].sort(),
    interiorColors: [...profile.interiorColors ?? []].sort(), maxPriceEur: profile.maxPriceEur,
    notify: { telegram: profile.notify.telegram, email: profile.notify.email }
  })).digest("hex").slice(0, 16);
}
