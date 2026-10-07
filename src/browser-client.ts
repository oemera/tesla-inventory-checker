import type { InventoryGateway, InventoryQuery } from "./domain.js";
import { TeslaInventoryClient } from "./tesla-client.js";

export class InventoryFailure extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds = 0) { super(code); }
}

export class BrowserInventoryClient implements InventoryGateway {
  constructor(private readonly baseUrl = "http://scraper:8080", private readonly request: typeof fetch = fetch) {}

  async fetchInventory(query: InventoryQuery): Promise<unknown[]> {
    const url = new URL("/inventory", this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.request(url, { signal: AbortSignal.timeout(210_000), redirect: "error" });
    } catch { throw new InventoryFailure("scraper_unreachable", 60); }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      // Do not log arbitrary upstream bodies, URLs or credentials.
      throw new InventoryFailure(`scraper_http_${response.status}`, Number.isFinite(retry) ? Math.max(0, retry) : 60);
    }
    const result: unknown = await response.json();
    if (!record(result) || result.version !== 1 || result.complete !== true || !Array.isArray(result.vehicles)
        || !record(result.query) || result.query.market !== query.market.toUpperCase()
        || result.query.model !== query.model || result.query.condition !== query.condition
        || typeof result.fetchedAt !== "string" || !Number.isFinite(Date.parse(result.fetchedAt))
        || Math.abs(Date.now() - Date.parse(result.fetchedAt)) > 240_000) {
      throw new InventoryFailure("invalid_snapshot");
    }
    return result.vehicles;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createGateway(env: NodeJS.ProcessEnv = process.env): InventoryGateway {
  const provider = env.INVENTORY_PROVIDER ?? "browser";
  if (provider === "browser") return new BrowserInventoryClient(env.SCRAPER_URL);
  if (provider === "direct") return new TeslaInventoryClient();
  throw new Error("INVENTORY_PROVIDER must be browser or direct.");
}
