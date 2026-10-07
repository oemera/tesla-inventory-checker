import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from inventory import InventoryError, collect_pages, parse_page, validate_query, countrywide_template, retry_after
from datetime import datetime, timezone
from browser import BrowserInventory

QUERY = dict(market='DE', model='m3', condition='used')


def vehicle(n):
    return dict(VIN=f'LRW3E7FA8PC{n:06d}', Model='m3')


class Pages(unittest.IsolatedAsyncioTestCase):
    async def test_all_pages(self):
        offsets = []
        async def fetch(payload):
            offsets.append(payload['offset'])
            return dict(results=[vehicle(i) for i in range(payload['offset'], min(payload['offset'] + 24, 57))], total_matches_found=57)
        rows, pages = await collect_pages({'query': QUERY}, QUERY, fetch)
        self.assertEqual((len(rows), pages, offsets), (57, 3, [0, 24, 48]))

    async def test_empty_exact_ignores_approximate(self):
        fetch = AsyncMock(return_value=dict(results=dict(exact=[], approximate=[vehicle(1)], approximateOutside=[]), total_matches_found=0))
        self.assertEqual(await collect_pages({}, QUERY, fetch), ([], 1))

    async def test_later_failure_never_returns_partial(self):
        fetch = AsyncMock(side_effect=[dict(results=[vehicle(1)], total_matches_found=2), InventoryError('rate_limited')])
        with self.assertRaisesRegex(InventoryError, 'rate_limited'):
            await collect_pages({}, QUERY, fetch)

    async def test_duplicate_stops_pagination(self):
        fetch = AsyncMock(return_value=dict(results=[vehicle(1)], total_matches_found=2))
        with self.assertRaisesRegex(InventoryError, 'inventory_changed'):
            await collect_pages({}, QUERY, fetch)

    async def test_changed_total(self):
        fetch = AsyncMock(side_effect=[dict(results=[vehicle(1)], total_matches_found=2), dict(results=[], total_matches_found=1)])
        with self.assertRaisesRegex(InventoryError, 'inventory_changed'):
            await collect_pages({}, QUERY, fetch)

    async def test_empty_page_before_total(self):
        with self.assertRaisesRegex(InventoryError, 'incomplete'):
            await collect_pages({}, QUERY, AsyncMock(return_value=dict(results=[], total_matches_found=2)))

    async def test_page_limit(self):
        with self.assertRaisesRegex(InventoryError, 'page_limit'):
            await collect_pages({}, QUERY, AsyncMock(return_value=dict(results=[vehicle(1)], total_matches_found=2)), max_pages=1)

    async def test_cooldown_prevents_repeated_browser_requests(self):
        backend = BrowserInventory()
        backend._snapshot = AsyncMock(side_effect=InventoryError('access_blocked', 900))
        backend.close = AsyncMock()
        with self.assertRaisesRegex(InventoryError, 'access_blocked'):
            await backend.snapshot(QUERY)
        with self.assertRaisesRegex(InventoryError, 'cooldown'):
            await backend.snapshot(QUERY)
        self.assertEqual(backend._snapshot.await_count, 1)

    async def test_transport_errors_are_redacted(self):
        backend = BrowserInventory()
        backend._snapshot = AsyncMock(side_effect=RuntimeError('secret-cookie'))
        backend.close = AsyncMock()
        with self.assertRaisesRegex(InventoryError, '^transport_or_browser_error$'):
            await backend.snapshot(QUERY)

    async def test_success_metadata(self):
        backend = BrowserInventory(); backend._snapshot = AsyncMock(return_value={'complete': True})
        self.assertTrue((await backend.snapshot(QUERY))['complete']); self.assertIsNotNone(backend.last_success)


class Validation(unittest.TestCase):
    def test_drops_hidden_site_filters(self):
        template = countrywide_template({'query': dict(QUERY, options={'Year': [2020]}, zip='12345', Odometer=[0,1000], paymentRange=[0,500])}, QUERY)
        self.assertEqual(template['query']['options'], {})
        self.assertEqual(template['query']['zip'], '')
        self.assertNotIn('Odometer', template['query'])
        self.assertNotIn('paymentRange', template['query'])

    def test_http_date_retry_after(self):
        self.assertEqual(retry_after('Wed, 07 Oct 2026 12:20:00 GMT', datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)), 1201)
        self.assertEqual(retry_after('invalid'), 300)

    def test_bad_queries(self):
        for query in [('US', 'm3', 'new'), ('DE', 'xx', 'new'), ('DE', 'm3', 'other')]:
            with self.assertRaises(InventoryError): validate_query(*query)

    def test_unknown_schema_not_empty(self):
        for data in ({}, [], {'results': None, 'total_matches_found': 0}, {'results': {}, 'total_matches_found': 0}, {'results': [], 'total_matches_found': True}):
            with self.assertRaises(InventoryError): parse_page(data, QUERY)

    def test_wrong_market_model_and_invalid_vin(self):
        for row in [dict(vehicle(1), Model='my'), dict(vehicle(1), CountryCode='US'), dict(vehicle(1), VIN='bad')]:
            with self.assertRaises(InventoryError): parse_page(dict(results=[row], total_matches_found=1), QUERY)

    def test_numeric_total_string(self):
        self.assertEqual(parse_page(dict(results=[], total_matches_found='0'), QUERY), ([], 0))


if __name__ == '__main__':
    unittest.main()
