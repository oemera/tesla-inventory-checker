import asyncio
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import AsyncMock
from server import handler_for
from inventory import InventoryError


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever)
        self.thread.start()
        self.backend = type('Backend', (), dict(last_success=None, last_error=None))()
        self.backend.snapshot = AsyncMock(return_value=dict(vehicles=[], complete=True, pages=1))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.backend, self.loop))
        self.http = threading.Thread(target=self.server.serve_forever)
        self.http.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.http.join()
        self.loop.call_soon_threadsafe(self.loop.stop); self.thread.join(); self.loop.close()

    def test_health_does_not_contact_tesla(self):
        with urllib.request.urlopen(self.base + '/health') as response:
            self.assertTrue(json.load(response)['alive'])
        self.backend.snapshot.assert_not_called()

    def test_complete_contract(self):
        with urllib.request.urlopen(self.base + '/inventory?market=de&model=m3&condition=new') as response:
            data = json.load(response)
        self.assertEqual(data['version'], 1); self.assertEqual(data['query']['market'], 'DE')
        self.assertTrue(data['complete']); self.assertIn('fetchedAt', data)

    def test_rejects_arbitrary_urls_and_duplicate_fields(self):
        for query in ('url=https://example.com', 'market=de&model=m3&model=my&condition=new'):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(self.base + '/inventory?' + query)
            self.assertEqual(caught.exception.code, 400); caught.exception.close()

    def test_retry_after(self):
        self.backend.snapshot.side_effect = InventoryError('rate_limited', 900)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.base + '/inventory?market=de&model=m3&condition=new')
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(caught.exception.headers['Retry-After'], '900'); caught.exception.close()
