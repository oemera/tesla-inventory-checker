import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.STATE_PATH ?? "/app/state/watcher.sqlite", {readOnly: true});
try {
  const last = db.prepare("SELECT started_at, finished_at, success, error FROM poll_runs ORDER BY id DESC LIMIT 1").get();
  const success = db.prepare("SELECT finished_at FROM poll_runs WHERE success=1 ORDER BY id DESC LIMIT 1").get();
  const deliveries = db.prepare("SELECT status, channel, count(*) AS count FROM deliveries GROUP BY status, channel").all();
  const reports = db.prepare("SELECT status, channel, count(*) AS count FROM stock_report_deliveries GROUP BY status, channel").all();
  const lastReport = db.prepare("SELECT slot_date,slot_time,timezone,payload FROM stock_reports ORDER BY expires_at DESC LIMIT 1").get();
  console.log(JSON.stringify({lastPoll: last, lastSuccessfulPoll: success, deliveries, reports, lastReport}, null, 2));
} finally { db.close(); }
