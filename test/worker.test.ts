import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AlertSender } from "../src/notifier.js";
import type { AppConfig, InventoryGateway, InventoryQuery, Match } from "../src/domain.js";
import { Store } from "../src/store.js";
import { Worker } from "../src/worker.js";

class FakeGateway implements InventoryGateway {
  public vehicles: unknown[] = [vehicle("one", "LRW3E7FA8PC000001")];
  async fetchInventory(_query: InventoryQuery): Promise<unknown[]> { return this.vehicles; }
}

class RecordingNotifier implements AlertSender {
  public matches: Match[] = [];
  async sendMatch(match: Match): Promise<void> { this.matches.push(match); }
  async sendChannel(match: Match): Promise<void> { this.matches.push(match); }
  async sendTechnicalError(_message: string): Promise<void> {}
}

const config: AppConfig = {
  profiles: [{
    id: "m3-grey-black", enabled: true, market: "de", model: "m3", condition: "new",
    trim: ["Premium Allradantrieb"], exteriorColors: ["Stealth Grey"], interiorColors: ["Schwarz"],
    notify: { telegram: true, email: false }
  }]
};

test("uses first successful poll as a quiet baseline and alerts only for subsequent new matching VINs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tesla-worker-"));
  const store = new Store(join(directory, "watcher.sqlite"));
  const gateway = new FakeGateway();
  const notifier = new RecordingNotifier();
  const worker = new Worker(config, gateway, store, notifier, false);

  assert.deepEqual(await worker.runOnce(), { fetched: 1, matches: 1, notified: 0 });
  assert.equal(notifier.matches.length, 0);

  gateway.vehicles = [vehicle("one", "LRW3E7FA8PC000001"), vehicle("two", "LRW3E7FA8PC000002")];
  assert.deepEqual(await worker.runOnce(), { fetched: 2, matches: 2, notified: 1 });
  assert.equal(notifier.matches[0].vehicle.vin, "LRW3E7FA8PC000002");

  assert.deepEqual(await worker.runOnce(), { fetched: 2, matches: 2, notified: 0 });
  store.close();
});

function vehicle(id: string, vin: string): Record<string, unknown> {
  return {
    vehicleId: id,
    vin,
    trimName: "Premium Allradantrieb",
    exteriorColor: "Stealth Grey",
    interiorColor: "Schwarz",
    price: "54.990 €",
    orderUrl: `https://example.test/${vin}`
  };
}
