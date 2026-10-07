import { createGateway } from "./browser-client.js";
import { normalizeVehicle } from "./normalize.js";
import type { Model } from "./domain.js";

// Read-only: no notification credentials, SQLite writes or production baseline.
const client = createGateway();
const condition = process.env.LIVE_CONDITION ?? "new";
if (condition !== "new" && condition !== "used") throw new Error("Invalid LIVE_CONDITION");
const requested = process.env.LIVE_MODEL;
if (requested && requested !== "m3" && requested !== "my") throw new Error("Invalid LIVE_MODEL");
const models: Model[] = requested ? [requested as Model] : ["m3", "my"];
for (const model of models) {
  const query = {market: "de", model, condition} as const;
  const raw = await client.fetchInventory(query);
  const vehicles = raw.map((v) => normalizeVehicle(v, query));
  if (vehicles.some((v) => !v)) throw new Error("Invalid normalized vehicle");
  console.info(JSON.stringify({market: "de", model, condition, vehicles: vehicles.length,
    withTrim: vehicles.filter((v) => v?.trim).length,
    withPaint: vehicles.filter((v) => v?.exteriorColor).length,
    withInterior: vehicles.filter((v) => v?.interiorColor).length}));
}
