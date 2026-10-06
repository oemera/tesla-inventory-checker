import { createRequire } from "node:module";
import type { InventoryGateway, InventoryQuery } from "./domain.js";

const require = createRequire(import.meta.url);

/**
 * The only component coupled to tesla-inventory. If Tesla changes its endpoint,
 * replace this adapter while leaving matching, persistence and notifications intact.
 */
export class TeslaInventoryClient implements InventoryGateway {
  async fetchInventory(query: InventoryQuery): Promise<unknown[]> {
    const createTeslaInventory = require("tesla-inventory") as (fetcher: (url: string) => Promise<string>) =>
      (inventory: string, options: Record<string, string>) => Promise<unknown>;
    const fetcher = async (url: string): Promise<string> => {
      const response = await fetch(url, {
        headers: { accept: "application/json,text/plain,*/*" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) {
        const hint = response.status === 403
          ? " Tesla blocked the direct inventory endpoint. Do not bypass its protections; verify access on the deployment host or use a permitted source."
          : "";
        throw new Error(`Tesla inventory request failed: HTTP ${response.status}.${hint}`);
      }
      return response.text();
    };
    const inventory = createTeslaInventory(fetcher);
    const result = await inventory(query.market, { model: query.model, condition: query.condition });
    return extractVehicles(result);
  }
}

function extractVehicles(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    for (const key of ["results", "vehicles", "data"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  throw new Error("Tesla inventory response did not contain a vehicle list.");
}
