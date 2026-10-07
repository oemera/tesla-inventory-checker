import { matchVehicle } from "./match.js";
import { normalizeVehicle } from "./normalize.js";
import type { AlertSender } from "./notifier.js";
import type { AppConfig, InventoryGateway, InventoryQuery, Match, Profile } from "./domain.js";
import { Store } from "./store.js";

export class Worker {
  constructor(
    private readonly config: AppConfig,
    private readonly gateway: InventoryGateway,
    private readonly store: Store,
    private readonly notifier: AlertSender,
    private readonly notifyOnFirstSeen: boolean
  ) {}

  async runOnce(): Promise<{ fetched: number; matches: number; notified: number }> {
    const pollId = this.store.startPoll();
    this.store.reconcileProfiles(this.config.profiles);
    try {
      let fetched = 0;
      let matches = 0;
      let notified = 0;
      const groups = groupProfiles(this.config.profiles.filter((profile) => profile.enabled));
      let failed: unknown;

      for (const group of groups) {
        try {
        const rawVehicles = await this.gateway.fetchInventory(group.query);
        const parsed = rawVehicles.map((raw) => normalizeVehicle(raw, group.query));
        if (parsed.some((vehicle) => vehicle === undefined)) throw new Error("invalid_vehicle_snapshot");
        const vehicles = parsed.filter(isVehicle);
        if (new Set(vehicles.map((v) => v.id)).size !== vehicles.length) throw new Error("duplicate_vehicle_snapshot");
        fetched += vehicles.length;
        this.store.transaction(() => {
        for (const profile of group.profiles) {
          const found = vehicles.map((vehicle) => matchVehicle(profile, vehicle)).filter(isVehicle);
          matches += found.length;
          this.store.queueMatches(profile, found, this.notifyOnFirstSeen);
        }
        });
        } catch (error) {
          // Preserve the first failure (including its cooldown) while other groups proceed.
          failed ??= error;
        }
      }
      notified = await this.dispatch();
      if (failed) throw failed;
      this.store.finishPoll(pollId, true);
      return { fetched, matches, notified };
    } catch (error) {
      this.store.finishPoll(pollId, false, "inventory_poll_failed");
      throw error;
    }
  }

  async dispatch(): Promise<number> {
    let sent = 0;
    for (const delivery of this.store.pending()) {
      try {
        await this.notifier.sendChannel(JSON.parse(delivery.payload) as Match, delivery.channel);
        this.store.delivered(delivery.id);
        sent += 1;
      } catch {
        this.store.retry(delivery);
        console.warn(JSON.stringify({event: "delivery_retry", channel: delivery.channel, attempt: delivery.attempts + 1}));
      }
    }
    return sent;
  }
}

function isVehicle<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function groupProfiles(profiles: Profile[]): Array<{ query: InventoryQuery; profiles: Profile[] }> {
  const groups = new Map<string, { query: InventoryQuery; profiles: Profile[] }>();
  for (const profile of profiles) {
    const query = { market: profile.market, model: profile.model, condition: profile.condition };
    const key = `${query.market}:${query.model}:${query.condition}`;
    const existing = groups.get(key);
    if (existing) existing.profiles.push(profile);
    else groups.set(key, { query, profiles: [profile] });
  }
  return [...groups.values()];
}
