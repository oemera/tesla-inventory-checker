import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.js";
import { Worker } from "../src/worker.js";
import { matchVehicle } from "../src/match.js";
import { normalizeVehicle } from "../src/normalize.js";
import { nextDelay, pollInterval } from "../src/runtime.js";
import type { Channel, Match, Profile } from "../src/domain.js";

const profile: Profile = {id: "test", enabled: true, market: "de", model: "m3", condition: "new", notify: {telegram: true, email: true}};
const raw = {VIN: "LRW3E7FA8PC000001", Model: "m3", trimName: "Premium AWD", PAINT: ["Stealth Grey"], INTERIOR: ["All Black"]};
const query = {market: "de", model: "m3", condition: "new"} as const;
const match: Match = {profile, vehicle: normalizeVehicle(raw, query)!};
class Sender {
  calls: Channel[] = [];
  failEmail = false;
  async sendChannel(_match: Match, channel: Channel) { this.calls.push(channel); if (channel === "email" && this.failEmail) throw new Error("offline"); }
  async sendMatch(match: Match) { await this.sendChannel(match, "telegram"); }
  async sendTechnicalError() {}
}

test("failed email stays pending; successful Telegram is not repeated, including after restart", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "tesla-outbox-")), "state.sqlite");
  let store = new Store(path);
  const sender = new Sender(); sender.failEmail = true;
  const gateway = {async fetchInventory() { return [raw]; }};
  let worker = new Worker({profiles: [profile]}, gateway, store, sender, true);
  assert.equal((await worker.runOnce()).notified, 1);
  assert.equal(store.pendingCount(), 1);
  await worker.runOnce();
  assert.deepEqual(sender.calls, ["telegram", "email"]);
  store.close();
  const db = new DatabaseSync(path); db.exec("UPDATE deliveries SET next_attempt=0"); db.close();
  store = new Store(path); sender.failEmail = false;
  worker = new Worker({profiles: [profile]}, gateway, store, sender, true);
  assert.equal(await worker.dispatch(), 1);
  assert.deepEqual(sender.calls, ["telegram", "email", "email"]);
  assert.equal(store.pendingCount(), 0);
  store.close();
});

test("quiet empty baseline later alerts on new vehicles", async () => {
  const store = new Store(":memory:"); const sender = new Sender();
  let rows: unknown[] = [];
  const worker = new Worker({profiles: [profile]}, {async fetchInventory() { return rows; }}, store, sender, false);
  await worker.runOnce(); rows = [raw]; await worker.runOnce();
  assert.equal(sender.calls.length, 2); store.close();
});

test("invalid snapshots cannot establish a baseline", async () => {
  const store = new Store(":memory:"); const sender = new Sender();
  let rows: unknown[] = [{}];
  const worker = new Worker({profiles: [profile]}, {async fetchInventory() { return rows; }}, store, sender, false);
  await assert.rejects(() => worker.runOnce()); rows = [raw]; await worker.runOnce();
  assert.equal(sender.calls.length, 0); store.close();
});

test("successful query group continues when another group fails", async () => {
  const store = new Store(":memory:"); const sender = new Sender();
  const worker = new Worker({profiles: [{...profile, id: "bad", model: "my"}, profile]}, {
    async fetchInventory(q) { if (q.model === "my") throw new Error("blocked"); return [raw]; }
  }, store, sender, true);
  await assert.rejects(() => worker.runOnce()); assert.equal(sender.calls.length, 2); store.close();
});

test("changed or disabled profiles cancel stale pending messages", () => {
  const store = new Store(":memory:"); store.queueMatches(profile, [match], true);
  store.reconcileProfiles([{...profile, maxPriceEur: 1}]); assert.equal(store.pendingCount(), 0);
  store.close();
});

test("changed profile gets a fresh quiet baseline", () => {
  const store = new Store(":memory:"); store.queueMatches(profile, [match], false);
  const updated = {...profile, exteriorColors: ["Stealth Grey"]};
  store.queueMatches(updated, [{...match, profile: updated}], false);
  assert.equal(store.pendingCount(), 0); store.close();
});

test("snapshot transaction rollback removes queued messages", () => {
  const store = new Store(":memory:");
  assert.throws(() => store.transaction(() => { store.queueMatches(profile, [match], true); throw new Error("rollback"); }));
  assert.equal(store.pendingCount(), 0); store.close();
});

test("v1 backup and VIN notification migration preserve prior deliveries", () => {
  const dir = mkdtempSync(join(tmpdir(), "tesla-migrate-")); const path = join(dir, "state.sqlite");
  let store = new Store(path);
  const legacy = {...match, vehicle: {...match.vehicle, id: "old-inventory-id"}};
  store.observe(legacy); store.recordNotification(legacy); store.markBaselineComplete(profile.id); store.close();
  const db = new DatabaseSync(path); db.exec("DROP TABLE deliveries; PRAGMA user_version=0;"); db.close();
  store = new Store(path); store.queueMatches(profile, [match], true);
  assert.equal(store.pendingCount(), 0); assert.equal(readdirSync(dir).filter((x) => x.includes("pre-v3")).length, 1); store.close();
});

test("strict filters don't confuse AWD with RWD or black with black/white", () => {
  const p = {...profile, trim: ["AWD"], interiorColors: ["Black"]};
  assert.equal(matchVehicle(p, {...match.vehicle, trim: "Premium AWD", interiorColor: "Black and White"}), undefined);
  assert.ok(matchVehicle({...profile, trim: ["Premium AWD"], interiorColors: ["All Black"]}, match.vehicle));
});

test("normalizes selected option labels and codes, price and safe fallback URL", () => {
  const vehicle = normalizeVehicle({...raw, PAINT: ["TEST_GREY"], InventoryPrice: 40000, orderUrl: "https://evil.example/",
    OptionCodeSpecs: {PAINT: {options: [{code: "TEST_GREY", name: "Stealth Grey"}, {code: "OTHER", name: "White"}]}}}, query)!;
  assert.equal(vehicle.exteriorColor, "Stealth Grey"); assert.equal(vehicle.exteriorCode, "TEST_GREY");
  assert.equal(vehicle.priceEur, 40000); assert.equal(vehicle.orderUrl, "https://www.tesla.com/de_DE/inventory/new/m3");
  assert.ok(matchVehicle({...profile, exteriorColors: ["TEST_GREY"]}, vehicle));
});

test("backoff respects retry-after and polling minimum", () => {
  assert.equal(pollInterval(undefined), 60); assert.throws(() => pollInterval("10"));
  assert.equal(nextDelay(60, 2, 900, 0), 900); assert.equal(nextDelay(60, 100, 0, 0), 3600);
});
