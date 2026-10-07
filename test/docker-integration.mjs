import assert from 'node:assert/strict';
import { BrowserInventoryClient } from '/app/dist/browser-client.js';
import { Store } from '/app/dist/store.js';
import { Worker } from '/app/dist/worker.js';

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
store.close();
console.log('PASS: fixture HTTP -> normalization -> matching -> SQLite outbox -> both simulated channels -> deduplication');
