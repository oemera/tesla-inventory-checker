import assert from "node:assert/strict";
import test from "node:test";
import { matchVehicle } from "../src/match.js";
import type { Profile, Vehicle } from "../src/domain.js";

const profile: Profile = {
  id: "m3-grey-black", enabled: true, market: "de", model: "m3", condition: "new",
  trim: ["Premium AWD", "Premium Allradantrieb"], exteriorColors: ["Stealth Grey", "Grau"], interiorColors: ["Schwarz"], maxPriceEur: 55000,
  notify: { telegram: true, email: false }
};

const vehicle: Vehicle = {
  id: "vehicle-1", model: "m3", trim: "Premium Allradantrieb", exteriorColor: "Stealth Grey", interiorColor: "Schwarz", priceEur: 54990,
  orderUrl: "https://example.test/order", raw: {}
};

test("matches aliases, accents and price limit", () => {
  assert.ok(matchVehicle(profile, vehicle));
  assert.equal(matchVehicle(profile, { ...vehicle, priceEur: 55001 }), undefined);
  assert.equal(matchVehicle(profile, { ...vehicle, interiorColor: "Weiß" }), undefined);
});
