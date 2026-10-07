import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { Notifier, settingsFromEnv } from "./notifier.js";
import { Store } from "./store.js";
import { createGateway, InventoryFailure } from "./browser-client.js";
import { Worker } from "./worker.js";
import { nextDelay, pollInterval } from "./runtime.js";
import { InventoryCache } from "./inventory-cache.js";
import { loadReportConfig } from "./report-config.js";
import { ReportScheduler } from "./report-scheduler.js";

const interval = pollInterval(process.env.POLL_INTERVAL_SECONDS);
const config = await loadConfig(process.env.CONFIG_PATH ?? "/app/config/profiles.json");
const notifier = new Notifier(settingsFromEnv(process.env));
notifier.validateFor(config.profiles);
const reportConfig = await loadReportConfig(process.env.REPORTS_CONFIG_PATH ?? "/app/config/reports.json");
notifier.validateReports(reportConfig);
const store = new Store(process.env.STATE_PATH ?? "/app/state/watcher.sqlite");
store.reconcileProfiles(config.profiles);
const gateway = new InventoryCache(createGateway());
const worker = new Worker(config, gateway, store, notifier, process.env.NOTIFY_ON_FIRST_SEEN === "true");
const reporter = new ReportScheduler(reportConfig, gateway, store, notifier);
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => abort.abort());
const heartbeat = setInterval(() => store.heartbeat(), 10_000);
store.heartbeat();
let failures = 0;
let lastTechnicalAlert = 0;
try {
  while (!abort.signal.aborted) {
    let retryAfter = 0;
    try {
      const result = await worker.runOnce();
      failures = 0;
      console.info(JSON.stringify({event: "poll_complete", ...result, pending: store.pendingCount()}));
    } catch (error) {
      failures += 1;
      retryAfter = error instanceof InventoryFailure ? error.retryAfterSeconds : 0;
      console.error(JSON.stringify({event: "poll_failed", failures, code: error instanceof InventoryFailure ? error.code : "inventory_error"}));
      if (process.env.TECHNICAL_ALERTS === "true" && failures >= 3 && Date.now() - lastTechnicalAlert >= 3_600_000) {
        try {
          await notifier.sendTechnicalError("Inventarabfragen wiederholt fehlgeschlagen. Bitte die lokalen Statusprotokolle prüfen.");
          lastTechnicalAlert = Date.now();
        } catch { console.error(JSON.stringify({event: "technical_alert_failed"})); }
      }
    }
    if (!abort.signal.aborted) await reporter.tick();
    const until = Date.now() + nextDelay(interval, failures, retryAfter) * 1000;
    while (!abort.signal.aborted && Date.now() < until) {
      await sleep(Math.min(10_000, until - Date.now()), undefined, {signal: abort.signal}).catch(() => {});
      if (!abort.signal.aborted) await worker.dispatch();
      if (!abort.signal.aborted) await reporter.tick();
    }
  }
} finally {
  clearInterval(heartbeat);
  store.close();
}
