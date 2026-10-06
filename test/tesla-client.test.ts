import assert from "node:assert/strict";
import test from "node:test";
import { TeslaInventoryClient } from "../src/tesla-client.js";

test("calls tesla-inventory for the German Model 3 inventory and unwraps its response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      total_matches_found: 1,
      results: [{ VIN: "LRW3E7FA8PC000001", Model: "m3", PAINT: ["Stealth Grey"] }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const results = await new TeslaInventoryClient().fetchInventory({ market: "de", model: "m3", condition: "new" });
    assert.equal(results.length, 1);
    assert.match(requestedUrl, /inventory-results/);
    assert.match(decodeURIComponent(requestedUrl), /"market":"DE"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
