"""Validated snapshots; browser and HTTP transports are injected for offline tests."""
import copy
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


class InventoryError(Exception):
    def __init__(self, code, retry_after=0):
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


def validate_query(market, model, condition):
    if market.lower() != 'de' or model not in ('m3', 'my') or condition not in ('new', 'used'):
        raise InventoryError('invalid_query')
    return dict(market='DE', model=model, condition=condition)


def countrywide_template(observed, query):
    actual = observed.get('query') if isinstance(observed, dict) else None
    if not isinstance(actual, dict) or any(actual.get(key) != value for key, value in query.items()):
        raise InventoryError('query_mismatch')
    # The public page may preselect years and an IP-derived postcode. Never inherit
    # those hidden filters into a countrywide watcher's baseline.
    return dict(query=dict(**query, options={}, arrangeby='Price', order='asc', language='de',
                           super_region=actual.get('super_region', 'europe'), lng='', lat='', zip='', range=0))


def retry_after(value, now=None):
    if value.isdigit():
        return max(300, int(value))
    try:
        until = parsedate_to_datetime(value)
        now = now or datetime.now(timezone.utc)
        return max(300, int((until - now).total_seconds()) + 1)
    except (TypeError, ValueError, OverflowError):
        return 300


def parse_page(data, query):
    if not isinstance(data, dict):
        raise InventoryError('schema_changed')
    total = data.get('total_matches_found')
    if isinstance(total, str) and total.isdigit():
        total = int(total)
    if type(total) is not int or total < 0:
        raise InventoryError('schema_changed')
    rows = data.get('results')
    if isinstance(rows, dict):
        # Approximate/outside results are not part of the requested exact inventory.
        if not all(isinstance(value, list) for value in rows.values()):
            raise InventoryError('schema_changed')
        rows = rows.get('exact')
    if not isinstance(rows, list):
        raise InventoryError('schema_changed')
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r'[A-HJ-NPR-Z0-9]{17}', str(row.get('VIN', ''))):
            raise InventoryError('invalid_vehicle')
        if row.get('Model') != query['model']:
            raise InventoryError('query_mismatch')
        if row.get('CountryCode', 'DE') != 'DE':
            raise InventoryError('query_mismatch')
    return rows, total


async def collect_pages(template, query, fetch, max_pages=100):
    """All-or-nothing. Changing totals/duplicates cannot establish a baseline."""
    result = []
    seen = set()
    expected_total = None
    for page in range(max_pages):
        payload = copy.deepcopy(template)
        payload.update(offset=len(result), count=24, outsideOffset=0, outsideSearch=False)
        rows, total = parse_page(await fetch(payload), query)
        if expected_total is not None and total != expected_total:
            raise InventoryError('inventory_changed_during_pagination')
        expected_total = total
        if len(rows) + len(result) > total:
            raise InventoryError('incomplete_snapshot')
        for row in rows:
            if row['VIN'] in seen:
                raise InventoryError('inventory_changed_during_pagination')
            seen.add(row['VIN'])
            result.append(row)
        if len(result) == total:
            return result, page + 1
        if not rows:
            raise InventoryError('incomplete_snapshot')
    raise InventoryError('page_limit_exceeded')
