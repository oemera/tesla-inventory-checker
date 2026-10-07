"""Only included in the fixture image, never production. No external requests."""
import asyncio
from http.server import ThreadingHTTPServer
import threading
from server import handler_for
from inventory import collect_pages


class Fixture:
    last_success = None
    last_error = None
    calls = 0

    async def snapshot(self, query):
        self.calls += 1
        count = min(self.calls, 2)
        async def fetch(_):
            return dict(total_matches_found=count, results=[dict(VIN=f'LRW3E7FA8PC{i:06d}', Model=query['model'],
                TrimName='Premium AWD', PAINT=['Stealth Grey'], INTERIOR=['All Black'], InventoryPrice=49000) for i in range(count)])
        rows, pages = await collect_pages({}, query, fetch)
        return dict(vehicles=rows, complete=True, pages=pages)


loop = asyncio.new_event_loop()
threading.Thread(target=loop.run_forever, daemon=True).start()
ThreadingHTTPServer(('0.0.0.0', 8080), handler_for(Fixture(), loop)).serve_forever()
