import type { InventoryQuery, Vehicle } from "./domain.js";

/** Converts Tesla's undocumented, changeable response into the application's stable format. */
export function normalizeVehicle(raw: unknown, query: InventoryQuery): Vehicle | undefined {
  if (!isRecord(raw)) return undefined;
  const vin = firstText(raw, ["vin", "VIN", "vinNumber", "VINNumber"]);
  const id = firstText(raw, ["id", "vehicleId", "vehicle_id", "inventoryId", "VIN", "vin"]) ?? vin;
  if (!id) return undefined;

  const orderUrl = firstText(raw, ["orderUrl", "purchaseUrl", "detailsUrl", "url", "Url"])
    ?? `https://www.tesla.com/${query.market}_DE/inventory/new/${query.model}`;

  return {
    id,
    vin,
    model: query.model,
    trim: firstText(raw, ["trimName", "trim", "TrimName", "trim_name", "modelName", "Model"]),
    exteriorColor: firstText(raw, ["exteriorColor", "paint", "PAINT", "color", "Color"]),
    interiorColor: firstText(raw, ["interiorColor", "interior", "INTERIOR", "Interior"]),
    priceEur: firstPrice(raw, ["price", "Price", "purchasePrice", "totalPrice", "TotalPrice"]),
    location: firstText(raw, ["location", "Location", "deliveryLocation", "deliveryLocationName"]),
    orderUrl,
    raw
  };
}

function firstText(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const item = value.find((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
      if (item) return item.trim();
    }
    if (isRecord(value)) {
      const nested = firstText(value, ["name", "label", "value", "displayName"]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function firstPrice(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const normalized = value.replace(/[^0-9,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
      const price = Number(normalized);
      if (Number.isFinite(price) && price > 0) return price;
    }
    if (isRecord(value)) {
      const nested = firstPrice(value, ["amount", "value", "price"]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
