// No production configuration is rendered: the inherited sandbox-only service has no secrets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const config = JSON.parse(execFileSync('docker', ['compose', '-f', 'compose.sandbox.yaml', 'config', '--format', 'json'], {encoding: 'utf8'}));
const service = config.services['sandbox-check'];
assert.equal(Object.keys(config.services).length, 1);
assert.equal(service.network_mode, 'none');
assert.equal(service.platform, 'linux/amd64');
assert.equal(service.init, true);
assert.equal(service.read_only, true);
assert.equal(service.privileged ?? false, false);
assert.equal(service.restart, 'no');
assert.equal(service.pids_limit, 256);
assert.deepEqual(service.cap_drop, ['ALL']);
assert.equal(service.cap_add?.length ?? 0, 0);
assert.equal(service.volumes?.length ?? 0, 0);
assert.equal(service.ports?.length ?? 0, 0);
assert.deepEqual(service.command, ['python', 'sandbox_check.py']);
assert.ok(service.security_opt.includes('no-new-privileges:true'));
assert.ok(service.security_opt.some(value => /seccomp=.*security\/chrome-seccomp\.json$/.test(value)));
assert.ok(!service.security_opt.some(value => value.includes('unconfined')));
assert.deepEqual(Object.keys(service.environment).sort(), ['BROWSER_NO_SANDBOX', 'SESSION_MAX_AGE_SECONDS']);
assert.equal(service.environment.BROWSER_NO_SANDBOX, 'false');
console.log('Compose sandbox policy checks passed.');
