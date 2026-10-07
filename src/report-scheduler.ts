import type { ReportConfig } from "./report-config.js";
import type { SnapshotReader } from "./inventory-cache.js";
import { dueReportSlot, REPORT_WINDOW_MS, type StockReport, type StockReportSender } from "./stock-report.js";
import type { Store } from "./store.js";

export class ReportScheduler {
  constructor(private readonly config: ReportConfig | undefined, private readonly inventory: SnapshotReader,
    private readonly store: Store, private readonly sender: StockReportSender, private readonly clock = Date.now) {}

  async tick(): Promise<number> {
    const now = this.clock();
    this.store.reconcileStockReports(this.config, now);
    const slot = dueReportSlot(this.config, now);
    if (slot && !this.store.hasStockReport(slot.id)) {
      const report: StockReport = {slot, createdAt: new Date(now).toISOString(),
        inventory: {m3: {count: null, asOf: null}, my: {count: null, asOf: null}}};
      for (const model of ["m3", "my"] as const) {
        try {
          const snapshot = await this.inventory.read({market: "de", model, condition: "new"});
          report.inventory[model] = {count: snapshot.vehicles.length, asOf: snapshot.fetchedAt};
        } catch { console.warn(JSON.stringify({event: "stock_report_fetch_failed", model})); }
      }
      if (this.clock() < slot.dueAt + REPORT_WINDOW_MS) this.store.queueStockReport(report, this.config!.notify);
    }
    let sent = 0;
    this.store.reconcileStockReports(this.config, this.clock());
    for (const delivery of this.store.pendingStockReports(this.clock())) {
      try {
        await this.sender.sendStockReport(JSON.parse(delivery.payload) as StockReport, delivery.channel);
        this.store.stockReportDelivered(delivery.id);
        sent += 1;
        console.info(JSON.stringify({event: "stock_report_sent", channel: delivery.channel}));
      } catch {
        this.store.retryStockReport(delivery, this.clock());
        console.warn(JSON.stringify({event: "stock_report_delivery_retry", channel: delivery.channel, attempt: delivery.attempts + 1}));
      }
    }
    return sent;
  }
}
