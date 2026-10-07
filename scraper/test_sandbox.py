import hashlib
import json
import os
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from browser import BrowserInventory
from inventory import InventoryError
from sandbox import parse_sandbox_status, require_sandbox, verify_browser_sandbox

STATUS = ('Sandbox Status\nLayer 1 Sandbox\tNamespace\nPID namespaces\tYes\n'
          'Network namespaces\tYes\nSeccomp-BPF sandbox\tYes\n'
          'Seccomp-BPF sandbox supports TSYNC\tYes\n')


class SandboxPolicy(unittest.TestCase):
    def test_sandbox_cannot_be_disabled(self):
        require_sandbox({})
        require_sandbox({'BROWSER_NO_SANDBOX': 'false'})
        for value in ('true', 'TRUE', '1', 'yes', 'invalid'):
            with self.subTest(value=value), self.assertRaisesRegex(InventoryError, 'browser_sandbox_required'):
                require_sandbox({'BROWSER_NO_SANDBOX': value})

    def test_requires_all_layers(self):
        self.assertTrue(all(parse_sandbox_status(STATUS).values()))
        for label in ('Layer 1 Sandbox\tNamespace', 'PID namespaces\tYes',
                      'Network namespaces\tYes', 'Seccomp-BPF sandbox\tYes'):
            with self.subTest(label=label):
                self.assertFalse(all(parse_sandbox_status(STATUS.replace(label, label.split('\t')[0] + '\tNo')).values()))

    def test_fail_closed_on_unknown_format(self):
        for value in (None, {}, '', 'You are adequately sandboxed.', STATUS.replace('\tYes', '\tYesterday')):
            self.assertFalse(all(parse_sandbox_status(value).values()))

    def test_vendored_profile_has_only_reviewed_additions(self):
        root = Path(__file__).resolve().parents[1] / 'security'
        raw = (root / 'docker-default.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), '514c38e72edc5363e87287ea87212211172c6c3251a974ca21ebfd05a56c7f5d')
        baseline = json.loads(raw)
        profile = json.loads((root / 'chrome-seccomp.json').read_text())
        additions = profile['syscalls'][len(baseline['syscalls']):]
        expected = [dict(names=['clone'], action='SCMP_ACT_ALLOW', includes={'arches': ['amd64']},
                         args=[dict(index=0, value=flags | 17, op='SCMP_CMP_EQ')])
                    for flags in (0x10000000, 0x30000000, 0x50000000, 0x70000000, 0x20000000)]
        expected += [dict(names=['unshare'], action='SCMP_ACT_ALLOW', includes={'arches': ['amd64']},
                          args=[dict(index=0, value=0x10000000, op='SCMP_CMP_EQ')]),
                     dict(names=['chroot'], action='SCMP_ACT_ALLOW', includes={'arches': ['amd64']})]
        self.assertEqual(additions, expected)
        profile['syscalls'] = profile['syscalls'][:len(baseline['syscalls'])]
        self.assertEqual(profile, baseline)


class SandboxStartup(unittest.IsolatedAsyncioTestCase):
    async def test_internal_status_page_verifies_sandbox(self):
        tab = Mock(evaluate=AsyncMock(return_value=STATUS))
        browser = Mock(get=AsyncMock(return_value=tab))
        self.assertTrue(all((await verify_browser_sandbox(browser)).values()))
        browser.get.assert_awaited_once_with('chrome://sandbox')
        tab.close.assert_not_called()

    async def test_missing_layer_is_rejected(self):
        browser = Mock(get=AsyncMock(return_value=Mock(evaluate=AsyncMock(return_value=STATUS.replace('Network namespaces\tYes', 'Network namespaces\tNo')))))
        with patch('sandbox.asyncio.sleep', new=AsyncMock()), self.assertRaisesRegex(InventoryError, 'browser_sandbox_unverified'):
            await verify_browser_sandbox(browser)

    async def test_browser_error_is_sanitized(self):
        browser = Mock(get=AsyncMock(side_effect=RuntimeError('secret response content')))
        with self.assertRaises(InventoryError) as caught:
            await verify_browser_sandbox(browser)
        self.assertEqual(str(caught.exception), 'browser_sandbox_unverified')

    async def test_sandbox_must_pass_before_network_warmup(self):
        backend = BrowserInventory()
        browser = Mock(get=AsyncMock())
        async def launch(): backend.browser = browser
        backend._launch = AsyncMock(side_effect=launch)
        with patch.dict(os.environ, {'BROWSER_NO_SANDBOX': 'false'}), \
             patch('browser.verify_browser_sandbox', new=AsyncMock(side_effect=InventoryError('browser_sandbox_unverified'))):
            with self.assertRaises(InventoryError): await backend.start()
        browser.get.assert_not_awaited()
        browser.stop.assert_called_once()
        self.assertEqual(backend.generation, 0)
        self.assertIsNone(backend.sandbox_status)

    async def test_offline_start_never_contacts_tesla(self):
        backend = BrowserInventory()
        browser = Mock(get=AsyncMock())
        async def launch(): backend.browser = browser
        backend._launch = AsyncMock(side_effect=launch)
        with patch.dict(os.environ, {'BROWSER_NO_SANDBOX': 'false'}), \
             patch('browser.verify_browser_sandbox', new=AsyncMock(return_value=parse_sandbox_status(STATUS))):
            await backend.start(warmup=False)
        browser.get.assert_not_awaited()
        self.assertEqual(backend.generation, 1)
        self.assertTrue(all(backend.sandbox_status.values()))
        await backend.close()
        self.assertIsNone(backend.sandbox_status)

    async def test_unsafe_setting_fails_before_launch(self):
        backend = BrowserInventory()
        backend._launch = AsyncMock()
        with patch.dict(os.environ, {'BROWSER_NO_SANDBOX': 'true'}), self.assertRaises(InventoryError):
            await backend.start()
        backend._launch.assert_not_awaited()
