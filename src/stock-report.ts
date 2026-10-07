import type { Channel, Model } from "./domain.js";
import type { ReportConfig } from "./report-config.js";

export interface ReportSlot { id: string; date: string; time: string; timezone: string; dueAt: number }
export interface StockReport {
  slot: ReportSlot;
  createdAt: string;
  inventory: Record<Model, {count: number | null; asOf: string | null}>;
}
export interface StockReportSender { sendStockReport(report: StockReport, channel: Channel): Promise<void> }

export const REPORT_WINDOW_MS = 60 * 60 * 1000;

/** Walk real minutes, not guessed UTC offsets: DST gaps are skipped, repeated wall times share an ID. */
export function dueReportSlot(config: ReportConfig | undefined, now: number): ReportSlot | undefined {
  if (!config?.enabled) return undefined;
  const formatter = new Intl.DateTimeFormat("en-GB", {timeZone: config.timezone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
  const minute = Math.floor(now / 60_000) * 60_000;
  for (let at = minute; now - at < REPORT_WINDOW_MS; at -= 60_000) {
    const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
    const time = `${parts.hour}:${parts.minute}`;
    if (!config.times.includes(time)) continue;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return {id: JSON.stringify([config.timezone, date, time]), date, time, timezone: config.timezone, dueAt: at};
  }
  return undefined;
}

export function formatStockReport(report: StockReport): string {
  const format = new Intl.DateTimeFormat("de-DE", {timeZone: report.slot.timezone, dateStyle: "short", timeStyle: "short"});
  const lines = ["📊 Tesla-Bestandsbericht – Deutschland", `Termin: ${report.slot.date} ${report.slot.time} (${report.slot.timezone})`, ""];
  for (const model of ["m3", "my"] as const) {
    const row = report.inventory[model];
    lines.push(`${model === "m3" ? "Model 3" : "Model Y"}: ${row.count === null ? "aktuell nicht verfügbar (Abruffehler)" : `${row.count} Fahrzeuge`}`);
    if (row.count !== null && row.asOf) lines.push(`Datenstand: ${format.format(new Date(row.asOf))}`);
  }
  if (report.inventory.m3.count !== null && report.inventory.my.count !== null) {
    lines.push(`Gesamt: ${report.inventory.m3.count + report.inventory.my.count} Fahrzeuge`);
  }
  lines.push("", "Gesamter Tesla-Bestand der Kategorie „Neu“, einschließlich dort gelisteter Vorführwagen.",
    "Ohne Suchprofile oder Ausstattungs-/Preisfilter. Keine Aussage über neue Zugänge seit dem letzten Bericht.",
    "Keine Garantie für einen bestimmten Liefertermin.");
  return lines.join("\n");
}
