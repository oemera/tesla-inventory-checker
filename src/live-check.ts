import { TeslaInventoryClient } from "./tesla-client.js";

const client = new TeslaInventoryClient();
for (const model of ["m3", "my"] as const) {
  const vehicles = await client.fetchInventory({ market: "de", model, condition: "new" });
  console.info(JSON.stringify({ market: "de", model, condition: "new", vehicles: vehicles.length }));
}
