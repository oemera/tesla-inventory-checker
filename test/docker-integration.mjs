import assert from 'node:assert/strict';
import { BrowserInventoryClient } from '/app/dist/browser-client.js';
import { Store } from '/app/dist/store.js';
import { Worker } from '/app/dist/worker.js';
import { InventoryCache } from '/app/dist/inventory-cache.js';
import { ReportScheduler } from '/app/dist/report-scheduler.js';

const store = new Store(':memory:');
const calls = [];
const sender = {async sendChannel(match, channel) { calls.push({id: match.vehicle.id, channel}); }};
const profiles = [{id:'integration', enabled:true, market:'de', model:'m3', condition:'new',
  trim:['Premium AWD'], exteriorColors:['Stealth Grey'], interiorColors:['All Black'],
  notify:{telegram:true, email:true}}];
const worker = new Worker({profiles}, new BrowserInventoryClient('http://fixture:8080'), store, sender, false);
assert.deepEqual(await worker.runOnce(), {fetched:1, matches:1, notified:0});
assert.deepEqual(await worker.runOnce(), {fetched:2, matches:2, notified:2});
assert.deepEqual(await worker.runOnce(), {fetched:2, matches:2, notified:0});
assert.deepEqual(calls.map((x) => x.channel), ['telegram', 'email']);
assert.equal(store.pendingCount(), 0);
const reportCalls = [];
const reports = new ReportScheduler({enabled:true, timezone:'Europe/Berlin', times:['08:00'],
  notify:{telegram:true,email:true}}, new InventoryCache(new BrowserInventoryClient('http://fixture:8080')),
  store, {async sendStockReport(report,channel){reportCalls.push({report,channel});}},
  () => Date.parse('2026-10-07T06:00:00Z'));
assert.equal(await reports.tick(), 2);
assert.equal(await reports.tick(), 0);
assert.deepEqual(reportCalls.map(x=>x.channel), ['telegram','email']);
assert.equal(reportCalls[0].report.inventory.m3.count, 2);
assert.equal(reportCalls[0].report.inventory.my.count, 2);
assert.equal(store.pendingStockReports().length, 0);
store.close();
console.log('PASS: fixture HTTP -> normalization -> matching -> SQLite outbox -> both simulated channels -> deduplication');
console.log('PASS: unfiltered Model 3 / Model Y stock reports -> both simulated channels -> durable deduplication');
