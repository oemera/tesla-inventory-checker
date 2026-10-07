"""Offline real-browser regression gate for the production container settings."""
import asyncio
import json
import os
from pathlib import Path
import subprocess

from browser import BrowserInventory


def check_container():
    fields = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    assert os.getuid() != 0, 'container must run as non-root'
    assert int(fields['CapEff'].strip(), 16) == 0, 'container must drop capabilities'
    assert fields['NoNewPrivs'].strip() == '1', 'no-new-privileges must remain enabled'
    assert fields['Seccomp'].strip() == '2', 'container seccomp filter required'
    for flag in ('--mount', '--net', '--uts'):
        result = subprocess.run(['unshare', flag, 'true'], capture_output=True, timeout=5)
        assert result.returncode != 0, f'unexpected namespace permission: {flag}'
    try:
        os.chroot('/tmp')
    except PermissionError:
        pass
    else:
        raise AssertionError('outer-container chroot must remain denied')


async def main():
    check_container()
    backend = BrowserInventory()
    try:
        await backend.start(warmup=False)
        assert backend.sandbox_status and all(backend.sandbox_status.values())
        print(json.dumps(dict(event='sandbox_check_passed', sandbox=backend.sandbox_status)), flush=True)
    finally:
        await backend.close()


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), timeout=75))
