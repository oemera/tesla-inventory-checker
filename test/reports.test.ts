import assert from "node:assert/strict";
import {mkdtempSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {validateReportConfig, loadReportConfig, type ReportConfig} from "../src/report-config.js";
import {dueReportSlot, formatStockReport, type StockReport} from "../src/stock-report.js";
import {InventoryCache} from "../src/inventory-cache.js";
import {InventoryFailure} from "../src/browser-client.js";
import {ReportScheduler} from "../src/report-scheduler.js";
import {Store} from "../src/store.js";
import {Worker} from "../src/worker.js";
import {Notifier} from "../src/notifier.js";
import type {Channel, InventoryQuery, Model, Profile} from "../src/domain.js";

const config: ReportConfig = {enabled:true, timezone:"Europe/Berlin", times:["08:00","12:00","16:00","20:00"], notify:{telegram:true,email:true}};
const morning = Date.parse("2026-10-07T06:00:00Z");
const raw = (model: Model, i: number) => ({VIN:`LRW3E7FA8PC${String(i).padStart(6,"0")}`, Model:model,
  TrimName: i===0 ? "Performance Allradantrieb" : "Hinterradantrieb", PAINT:["White"], INTERIOR:["Zen Grau"], InventoryPrice:100000, IsDemo:i===0});

class Sender {
  calls: Array<{report:StockReport;channel:Channel}> = [];
  failEmail = false;
  async sendStockReport(report:StockReport, channel:Channel) {
    if(channel==="email" && this.failEmail) throw new Error("SMTP unavailable");
    this.calls.push({report,channel});
  }
  async sendChannel() {}
  async sendMatch() {}
  async sendTechnicalError() {}
}

test("report configuration validates times, timezone and independent channels", () => {
  assert.deepEqual(validateReportConfig(config),config);
  assert.deepEqual(validateReportConfig({...config,times:["20:00","08:00"]}).times,["08:00","20:00"]);
  for(const change of [{times:["24:00"]},{times:["8:00"]},{times:["12:60"]},{times:["08:00","08:00"]},
    {times:[]},{timezone:"Unknown/Zone"},{notify:{telegram:false,email:false}},{notify:{telegram:true}},
    {enabled:"true"},{typo:true}]) assert.throws(()=>validateReportConfig({...config,...change}));
  assert.doesNotThrow(()=>validateReportConfig({...config,enabled:false,times:[],notify:{telegram:false,email:false}}));
});

test("missing report file disables the optional feature", async () => {
  assert.equal(await loadReportConfig(join(mkdtempSync(join(tmpdir(),"tesla-report-missing-")),"missing.json")),undefined);
});

test("four daily report slots use German local time, not UTC", () => {
  for(const hour of [6,10,14,18]) {
    const now=Date.parse(`2026-10-07T${String(hour).padStart(2,"0")}:00:00Z`);
    assert.equal(dueReportSlot(config,now)?.time,`${String(hour+2).padStart(2,"0")}:00`);
  }
  assert.equal(dueReportSlot(config,morning-1),undefined);
  assert.equal(dueReportSlot(config,morning+60*60*1000),undefined);
  assert.equal(dueReportSlot({...config,enabled:false},morning),undefined);
  assert.equal(dueReportSlot(config,Date.parse("2026-12-07T07:00:00Z"))?.time,"08:00");
});

test("late startup catches up only the latest slot within one hour", () => {
  const c={...config,times:["08:00","08:15"]};
  assert.equal(dueReportSlot(c,morning+30*60*1000)?.time,"08:15");
  assert.equal(dueReportSlot(c,morning+80*60*1000),undefined);
});

test("DST spring gap is skipped, autumn duplicate hour has one stable report ID", () => {
  const c={...config,times:["02:30"]};
  assert.equal(dueReportSlot(c,Date.parse("2026-03-29T01:40:00Z")),undefined);
  const first=dueReportSlot(c,Date.parse("2026-10-25T00:30:00Z"));
  const second=dueReportSlot(c,Date.parse("2026-10-25T01:30:00Z"));
  assert.ok(first); assert.equal(first.id,second?.id);
});

test("midnight slot handles the previous date during catch-up", () => {
  const slot=dueReportSlot({...config,times:["23:45"]},Date.parse("2026-10-07T22:10:00Z"));
  assert.equal(slot?.date,"2026-10-07"); assert.equal(slot?.time,"23:45");
});

test("reports count both complete new inventories without any profile, including demo cars", async () => {
  const queries:InventoryQuery[]=[];
  const cache=new InventoryCache({async fetchInventory(q){queries.push(q); return [raw(q.model,0),raw(q.model,1)];}},()=>morning);
  const store=new Store(":memory:"); const sender=new Sender();
  try {
    const reports=new ReportScheduler(config,cache,store,sender,()=>morning);
    assert.equal(await reports.tick(),2);
    assert.deepEqual(queries,[{market:"de",model:"m3",condition:"new"},{market:"de",model:"my",condition:"new"}]);
    assert.equal(sender.calls[0].report.inventory.m3.count,2);
    assert.equal(sender.calls[0].report.inventory.my.count,2);
    assert.equal(await reports.tick(),0); assert.equal(queries.length,2);
  } finally {store.close();}
});

test("profile filters and quiet baseline never suppress stock reports; snapshots are shared", async () => {
  let calls=0;
  const cache=new InventoryCache({async fetchInventory(q){calls++;return [raw(q.model,0),raw(q.model,1)];}},()=>morning);
  const profile:Profile={id:"restrictive",enabled:true,market:"de",model:"m3",condition:"new",
    trim:["Premium"],exteriorColors:["Marine Blue"],maxPriceEur:1,notify:{telegram:true,email:false}};
  const store=new Store(":memory:"); const sender=new Sender();
  try {
    const worker=new Worker({profiles:[profile]},cache,store,sender,false);
    assert.equal((await worker.runOnce()).matches,0);
    await new ReportScheduler(config,cache,store,sender,()=>morning).tick();
    assert.equal(calls,2); assert.equal(sender.calls[0].report.inventory.m3.count,2);
    store.reconcileProfiles([]);
    assert.ok(store.hasStockReport(sender.calls[0].report.slot.id));
  } finally {store.close();}
});

test("empty inventories are valid zero counts; failures are explicitly unavailable, not zero", async () => {
  const cache=new InventoryCache({async fetchInventory(q){if(q.model==="my") throw new InventoryFailure("blocked",900); return [];}},()=>morning);
  const store=new Store(":memory:"); const sender=new Sender();
  try {
    await new ReportScheduler(config,cache,store,sender,()=>morning).tick();
    const report=sender.calls[0].report;
    assert.equal(report.inventory.m3.count,0); assert.equal(report.inventory.my.count,null);
    const text=formatStockReport(report);
    assert.match(text,/Model 3: 0 Fahrzeuge/); assert.match(text,/Model Y: aktuell nicht verfügbar/);
    assert.doesNotMatch(text,/Gesamt:/);
  } finally {store.close();}
});

test("delivery retry persists across restart without repeating the successful channel", async () => {
  let now=morning; let fetches=0;
  const cache=new InventoryCache({async fetchInventory(){fetches++;return [];}},()=>now);
  const path=join(mkdtempSync(join(tmpdir(),"tesla-report-restart-")),"state.sqlite");
  let store=new Store(path); const sender=new Sender(); sender.failEmail=true;
  await new ReportScheduler(config,cache,store,sender,()=>now).tick();
  assert.deepEqual(sender.calls.map(x=>x.channel),["telegram"]);
  store.close(); store=new Store(path); sender.failEmail=false; now+=31_000;
  try {
    await new ReportScheduler(config,cache,store,sender,()=>now).tick();
    assert.deepEqual(sender.calls.map(x=>x.channel),["telegram","email"]); assert.equal(fetches,2);
    await new ReportScheduler(config,cache,store,sender,()=>now).tick();
    assert.equal(sender.calls.length,2);
  } finally {store.close();}
});

test("disabled channels, disabled reporting and expired reports cancel pending delivery", async () => {
  for(const mode of ["channel","disabled","expired"] as const) {
    let now=morning; const store=new Store(":memory:"); const sender=new Sender(); sender.failEmail=true;
    const cache=new InventoryCache({async fetchInventory(){return [];}},()=>now);
    try {
      await new ReportScheduler(config,cache,store,sender,()=>now).tick(); sender.failEmail=false;
      now+=mode==="expired"?60*60*1000:31_000;
      const changed=mode==="channel"?{...config,notify:{telegram:true,email:false}}:mode==="disabled"?{...config,enabled:false}:config;
      await new ReportScheduler(changed,cache,store,sender,()=>now).tick();
      assert.equal(sender.calls.length,1,mode); assert.equal(store.pendingStockReports(now).length,0);
    } finally {store.close();}
  }
});

test("identical counts still produce all four scheduled reports", async () => {
  let now=morning; const store=new Store(":memory:"); const sender=new Sender();
  const cache=new InventoryCache({async fetchInventory(){return [];}},()=>now);
  const scheduler=new ReportScheduler(config,cache,store,sender,()=>now);
  try {
    for(const hour of [0,4,8,12]) {now=morning+hour*3600000; await scheduler.tick();}
    assert.equal(sender.calls.length,8); assert.equal(new Set(sender.calls.map(x=>x.report.slot.id)).size,4);
  } finally {store.close();}
});

test("inventory cache refreshes after 60 seconds and never serves stale data after failure", async () => {
  let now=morning; let calls=0; let fail=false;
  const cache=new InventoryCache({async fetchInventory(){calls++;if(fail)throw new InventoryFailure("blocked",900);return [raw("m3",0)];}},()=>now);
  const q={market:"de",model:"m3",condition:"new"} as const;
  await Promise.all([cache.read(q),cache.read(q)]); assert.equal(calls,1);
  now+=59_000; await cache.read(q); assert.equal(calls,1);
  now+=1_000; fail=true; await assert.rejects(()=>cache.read(q)); assert.equal(calls,2);
  now+=60_000; await assert.rejects(()=>cache.read(q), (e: unknown) => e instanceof InventoryFailure && e.retryAfterSeconds===840); assert.equal(calls,2);
  now+=840_000; fail=false; await cache.read(q); assert.equal(calls,3);
});

test("malformed and duplicate inventory snapshots cannot become a report count", async () => {
  for(const rows of [[{}],[raw("m3",0),raw("m3",0)]]) {
    const cache=new InventoryCache({async fetchInventory(){return rows;}},()=>morning);
    await assert.rejects(()=>cache.read({market:"de",model:"m3",condition:"new"}));
  }
});

test("reports validate their own notification channels independently of profile channels", () => {
  const n=new Notifier({telegramBotToken:"fake",telegramChatId:"fake"});
  assert.throws(()=>n.validateReports(config),/SMTP/);
  assert.doesNotThrow(()=>n.validateReports({...config,notify:{telegram:true,email:false}}));
  assert.doesNotThrow(()=>n.validateReports({...config,enabled:false}));
  assert.throws(()=>new Notifier({}).validateReports(config),/Telegram/);
});

test("v2 database migration backs up and preserves existing notification state", () => {
  const dir=mkdtempSync(join(tmpdir(),"tesla-report-migration-")); const path=join(dir,"state.sqlite");
  let store=new Store(path); store.markBaselineComplete("existing-profile"); store.close();
  const db=new DatabaseSync(path); db.exec("DROP TABLE stock_report_deliveries; DROP TABLE stock_reports; PRAGMA user_version=2;"); db.close();
  store=new Store(path);
  try {assert.ok(store.isBaselineComplete("existing-profile"));assert.equal(store.pendingStockReports().length,0);}
  finally {store.close();}
  assert.equal(readdirSync(dir).filter(x=>x.includes("pre-v3")).length,1);
});
