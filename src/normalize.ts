import type { InventoryQuery, Vehicle } from "./domain.js";

/** Converts Tesla's undocumented, changeable response into the application's stable format. */
export function normalizeVehicle(raw: unknown, query: InventoryQuery): Vehicle | undefined {
  if (!isRecord(raw)) return undefined;
  const vin = firstText(raw, ["vin", "VIN", "vinNumber", "VINNumber"]);
  const id = vin ?? firstText(raw, ["id", "vehicleId", "vehicle_id", "inventoryId"]);
  if (!id) return undefined;
  if (raw.Model !== undefined && raw.Model !== query.model) return undefined;
  if (raw.CountryCode !== undefined && raw.CountryCode !== "DE") return undefined;

  const candidate = firstText(raw, ["orderUrl", "purchaseUrl", "detailsUrl", "url", "Url"]);
  let orderUrl = `https://www.tesla.com/de_DE/inventory/${query.condition}/${query.model}`;
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && url.hostname === "www.tesla.com" && !url.username && !url.password) orderUrl = url.href;
    } catch { /* A malformed or non-Tesla link is never forwarded. */ }
  }

  return {
    id,
    vin,
    model: query.model,
    condition: query.condition,
    trimCode: firstText(raw, ["TRIM"]),
    exteriorCode: firstText(raw, ["PAINT"]),
    interiorCode: firstText(raw, ["INTERIOR"]),
    trim: optionLabel(raw, "TRIM") ?? firstText(raw, ["TrimName", "trimName", "trim", "trim_name", "modelName"]),
    exteriorColor: optionLabel(raw, "PAINT") ?? firstText(raw, ["exteriorColor", "paint", "PAINT", "color", "Color"]),
    interiorColor: optionLabel(raw, "INTERIOR") ?? firstText(raw, ["interiorColor", "interior", "INTERIOR", "Interior"]),
    priceEur: firstPrice(raw, ["InventoryPrice", "PurchasePrice", "price", "Price", "purchasePrice", "totalPrice", "TotalPrice"]),
    location: firstText(raw, ["location", "Location", "deliveryLocation", "deliveryLocationName"]),
    orderUrl,
    raw: undefined
  };
}

function optionLabel(raw: Record<string, unknown>, group: string): string | undefined {
  const selectedCodes = typeof raw.OptionCodeList === "string" ? raw.OptionCodeList.split(",")
    : Array.isArray(raw.OptionCodeList) ? raw.OptionCodeList : [];
  const canonical = (value: unknown) => typeof value === "string" ? value.trim().replace(/^\$/, "") : "";
  const selected = new Set(selectedCodes.map(canonical).filter(Boolean));
  if (Array.isArray(raw.OptionCodeData)) {
    const entries = raw.OptionCodeData.filter((option) => isRecord(option) && option.group === group && selected.has(canonical(option.code)));
    if (entries.length === 1 && isRecord(entries[0])) return firstText(entries[0], ["name", "description", "long_name"]);
  }
  const specs = raw.OptionCodeSpecs;
  if (!isRecord(specs) || !isRecord(specs[group])) return undefined;
  const options = specs[group].options;
  if (!Array.isArray(options)) return undefined;
  const groupCodes = raw[group];
  const codes = Array.isArray(groupCodes) ? groupCodes : [groupCodes];
  const matches = options.filter((option) => isRecord(option) && codes.includes(option.code));
  return matches.length === 1 && isRecord(matches[0]) ? firstText(matches[0], ["name", "description"]) : undefined;
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
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
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
