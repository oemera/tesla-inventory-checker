import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeVehicle } from "../src/normalize.js";

test("normalizes a saved Tesla inventory fixture", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/tesla-inventory-response.json", import.meta.url), "utf8")) as unknown[];
  const vehicle = normalizeVehicle(fixture[0], { market: "de", model: "m3", condition: "new" });
  assert.deepEqual(vehicle && {
    id: vehicle.id,
    vin: vehicle.vin,
    model: vehicle.model,
    trim: vehicle.trim,
    exteriorColor: vehicle.exteriorColor,
    interiorColor: vehicle.interiorColor,
    priceEur: vehicle.priceEur,
    location: vehicle.location,
    orderUrl: vehicle.orderUrl
  }, {
    id: "inventory-123456",
    vin: "LRW3E7FA8PC123456",
    model: "m3",
    trim: "Premium Allradantrieb",
    exteriorColor: "Stealth Grey",
    interiorColor: "Schwarz",
    priceEur: 54990,
    location: "Berlin",
    orderUrl: "https://www.tesla.com/de_DE/order/LRW3E7FA8PC123456"
  });
});

test("rejects an inventory item without a stable identifier", () => {
  assert.equal(normalizeVehicle({ trimName: "Premium AWD" }, { market: "de", model: "m3", condition: "new" }), undefined);
});

test("accepts a text value nested in a Tesla option array", () => {
  const vehicle = normalizeVehicle({ VIN: "LRW3E7FA8PC000001", PAINT: ["Stealth Grey"] }, { market: "de", model: "m3", condition: "new" });
  assert.equal(vehicle?.exteriorColor, "Stealth Grey");
});
