import { matchVehicle } from "./match.js";
import { normalizeVehicle } from "./normalize.js";
import type { AlertSender } from "./notifier.js";
import type { AppConfig, InventoryGateway, InventoryQuery, Profile } from "./domain.js";
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
    try {
      let fetched = 0;
      let matches = 0;
      let notified = 0;
      const groups = groupProfiles(this.config.profiles.filter((profile) => profile.enabled));

      for (const group of groups) {
        const rawVehicles = await this.gateway.fetchInventory(group.query);
        const vehicles = rawVehicles.map((raw) => normalizeVehicle(raw, group.query)).filter(isVehicle);
        fetched += vehicles.length;
        for (const profile of group.profiles) {
          const baselineComplete = this.store.isBaselineComplete(profile.id);
          for (const vehicle of vehicles) {
            const match = matchVehicle(profile, vehicle);
            if (!match) continue;
            matches += 1;
            const seenBefore = this.store.hasSeen(profile.id, vehicle.id);
            this.store.observe(match);
            if ((!seenBefore && (baselineComplete || this.notifyOnFirstSeen)) && !this.store.hasNotified(profile.id, vehicle.id)) {
              await this.notifier.sendMatch(match);
              this.store.recordNotification(match);
              notified += 1;
            }
          }
          this.store.markBaselineComplete(profile.id);
        }
      }
      this.store.finishPoll(pollId, true);
      return { fetched, matches, notified };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.finishPoll(pollId, false, message);
      throw error;
    }
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
