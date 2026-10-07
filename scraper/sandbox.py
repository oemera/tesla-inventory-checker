"""Fail closed unless Chromium confirms the expected Linux sandbox layers."""
import asyncio
import os
import re

from inventory import InventoryError


def require_sandbox(env=None):
    env = os.environ if env is None else env
    if env.get('BROWSER_NO_SANDBOX', 'false').strip().lower() not in ('', 'false'):
        raise InventoryError('browser_sandbox_required', 900)


def parse_sandbox_status(text):
    if not isinstance(text, str):
        return dict(namespace=False, pid=False, network=False, seccomp=False)
    expected = dict(namespace=('Layer 1 Sandbox', 'Namespace'),
                    pid=('PID namespaces', 'Yes'),
                    network=('Network namespaces', 'Yes'),
                    seccomp=('Seccomp-BPF sandbox', 'Yes'))
    return {key: bool(re.search(r'^' + re.escape(label) + r'[ \t]+' + value + r'[ \t]*$', text, re.MULTILINE))
            for key, (label, value) in expected.items()}


async def verify_browser_sandbox(browser):
    async def inspect():
        tab = await browser.get('chrome://sandbox')
        for _ in range(20):
            status = parse_sandbox_status(await tab.evaluate('document.body.innerText'))
            if all(status.values()):
                # Keep this internal tab until browser cleanup: closing the current
                # tab can invalidate nodriver's main_tab reference.
                return status
            await asyncio.sleep(0.1)
        return None

    try:
        status = await asyncio.wait_for(inspect(), timeout=10)
        if status:
            return status
    except Exception:
        # Never expose browser response content, paths, cookies or credentials.
        pass
    raise InventoryError('browser_sandbox_unverified', 900)
