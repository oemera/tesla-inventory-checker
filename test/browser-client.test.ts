import assert from "node:assert/strict";
import test from "node:test";
import { BrowserInventoryClient, createGateway, InventoryFailure } from "../src/browser-client.js";

const query = {market: "de", model: "m3", condition: "new"} as const;
const snapshot = () => ({version: 1, complete: true, query: {...query, market: "DE"}, fetchedAt: new Date().toISOString(), vehicles: []});
function client(body: unknown, status = 200, headers = {}) {
  return new BrowserInventoryClient("http://fixture:8080", async () => new Response(JSON.stringify(body), {status, headers}));
}
test("accepts a fresh complete empty snapshot", async () => assert.deepEqual(await client(snapshot()).fetchInventory(query), []));
for (const [name, changed] of Object.entries({partial: {complete: false}, old: {fetchedAt: "2020-01-01"}, wrongModel: {query: {...query, model: "my"}}, malformed: {vehicles: {}}, version: {version: 2}})) {
  test(`rejects ${name} snapshots`, async () => assert.rejects(() => client({...snapshot(), ...changed}).fetchInventory(query), /invalid_snapshot/));
}
test("propagates cooldown without logging upstream bodies", async () => {
  await assert.rejects(() => client({error: "secret"}, 503, {"Retry-After": "900"}).fetchInventory(query), (error: unknown) => error instanceof InventoryFailure && error.retryAfterSeconds === 900 && !error.message.includes("secret"));
});
test("provider is explicit; unknown providers do not silently fall back", () => assert.throws(() => createGateway({INVENTORY_PROVIDER: "typo"}), /must be/));
