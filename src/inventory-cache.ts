import type { InventoryGateway, InventoryQuery, Vehicle } from "./domain.js";
import { InventoryFailure } from "./browser-client.js";
import { normalizeVehicle } from "./normalize.js";

export interface InventorySnapshot { raw: unknown[]; vehicles: Vehicle[]; fetchedAt: string }
export interface SnapshotReader { read(query: InventoryQuery): Promise<InventorySnapshot> }

/** Shares complete, unfiltered snapshots between profile checks and stock reports. */
export class InventoryCache implements InventoryGateway, SnapshotReader {
  private readonly snapshots = new Map<string, {value: InventorySnapshot; at: number}>();
  private readonly failures = new Map<string, {error: unknown; until: number}>();
  private readonly active = new Map<string, Promise<InventorySnapshot>>();

  constructor(private readonly gateway: InventoryGateway, private readonly clock = Date.now) {}

  async fetchInventory(query: InventoryQuery): Promise<unknown[]> { return (await this.read(query)).raw; }

  async read(query: InventoryQuery): Promise<InventorySnapshot> {
    const key = `${query.market.toLowerCase()}:${query.model}:${query.condition}`;
    const now = this.clock();
    const pending = this.active.get(key);
    if (pending) return pending;
    const failure = this.failures.get(key);
    if (failure && now < failure.until) {
      if (failure.error instanceof InventoryFailure) {
        throw new InventoryFailure(failure.error.code, Math.ceil((failure.until - now) / 1000));
      }
      throw failure.error;
    }
    const cached = this.snapshots.get(key);
    if (cached && now >= cached.at && now - cached.at < 60_000) return cached.value;
    const operation = this.fetch(query, key);
    this.active.set(key, operation);
    try { return await operation; }
    finally { this.active.delete(key); }
  }

  private async fetch(query: InventoryQuery, key: string): Promise<InventorySnapshot> {
    try {
      const raw = await this.gateway.fetchInventory(query);
      if (!Array.isArray(raw)) throw new InventoryFailure("invalid_snapshot", 60);
      const parsed = raw.map((row) => normalizeVehicle(row, query));
      if (parsed.some((row) => !row)) throw new InventoryFailure("invalid_snapshot", 60);
      const vehicles = parsed as Vehicle[];
      if (new Set(vehicles.map((vehicle) => vehicle.id)).size !== vehicles.length) throw new InventoryFailure("duplicate_snapshot", 60);
      const now = this.clock();
      const value = {raw, vehicles, fetchedAt: new Date(now).toISOString()};
      this.snapshots.set(key, {value, at: now});
      this.failures.delete(key);
      return value;
    } catch (error) {
      this.snapshots.delete(key); // Never fall back to a stale count, including after errors.
      const seconds = error instanceof InventoryFailure ? error.retryAfterSeconds : 60;
      this.failures.set(key, {error, until: this.clock() + Math.max(60, seconds) * 1000});
      throw error;
    }
  }
}
