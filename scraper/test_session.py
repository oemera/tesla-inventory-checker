import sys
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
import unittest
from browser import BrowserInventory
from inventory import InventoryError

QUERY = dict(market='DE', model='m3', condition='used')


def response(status=200, retry='0'):
    return SimpleNamespace(status_code=status, headers={'retry-after': retry}, json=lambda: dict(results=[], total_matches_found=0))


class Sessions(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.backend = BrowserInventory()
        async def start():
            self.backend.browser = object(); self.backend.created = time.monotonic(); self.backend.generation += 1
        async def close():
            self.backend.browser = None
        self.backend.start = AsyncMock(side_effect=start)
        self.backend.close = AsyncMock(side_effect=close)
        self.backend.prepare = AsyncMock(return_value=({'query': QUERY}, {}, 'https://www.tesla.com/'))
        self.get = Mock(return_value=response())
        self.patch = patch.dict(sys.modules, {'curl_cffi': SimpleNamespace(requests=SimpleNamespace(get=self.get))})
        self.patch.start()

    async def asyncTearDown(self): self.patch.stop()

    async def test_reuses_session(self):
        first = await self.backend.snapshot(QUERY); second = await self.backend.snapshot(QUERY)
        self.assertEqual(first['sessionGeneration'], second['sessionGeneration'])
        self.assertEqual(self.backend.start.await_count, 1)

    async def test_session_age_renews(self):
        await self.backend.snapshot(QUERY); self.backend.created = time.monotonic() - 2000
        self.assertEqual((await self.backend.snapshot(QUERY))['sessionGeneration'], 2)

    async def test_rejected_session_renews_once(self):
        self.get.side_effect = [response(403), response()]
        self.assertTrue((await self.backend.snapshot(QUERY))['complete'])
        self.assertEqual(self.backend.start.await_count, 2)

    async def test_repeated_403_stops(self):
        self.get.return_value = response(403)
        with self.assertRaisesRegex(InventoryError, 'session_rejected'): await self.backend.snapshot(QUERY)
        self.assertEqual(self.get.call_count, 2)
        with self.assertRaisesRegex(InventoryError, 'cooldown'): await self.backend.snapshot(QUERY)
        self.assertEqual(self.get.call_count, 2)

    async def test_429_no_immediate_renewal(self):
        self.get.return_value = response(429, '1200')
        with self.assertRaises(InventoryError) as caught: await self.backend.snapshot(QUERY)
        self.assertEqual(caught.exception.retry_after, 1200); self.assertEqual(self.get.call_count, 1)

    async def test_browser_challenge_is_not_retried(self):
        self.backend.prepare.side_effect = InventoryError('access_blocked', 900)
        with self.assertRaises(InventoryError): await self.backend.snapshot(QUERY)
        self.assertEqual(self.backend.start.await_count, 1); self.assertEqual(self.get.call_count, 0)
