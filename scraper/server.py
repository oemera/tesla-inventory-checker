"""Private, fixed-purpose HTTP boundary. Never accepts target URLs or logs cookies."""
import asyncio
import concurrent.futures
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import signal
import threading
from urllib.parse import parse_qs, urlparse

from browser import BrowserInventory
from inventory import InventoryError, validate_query


def handler_for(backend, loop):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, payload, retry=0):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            if retry:
                self.send_header('Retry-After', str(retry))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == '/health':
                return self.reply(200, dict(alive=True, lastSuccess=backend.last_success, lastError=backend.last_error,
                                           sandbox=getattr(backend, 'sandbox_status', None)))
            if url.path != '/inventory':
                return self.reply(404, dict(error='not_found'))
            future = None
            try:
                params = parse_qs(url.query)
                if set(params) != {'market', 'model', 'condition'} or any(len(v) != 1 for v in params.values()):
                    raise InventoryError('invalid_query')
                query = validate_query(*(params[key][0] for key in ('market', 'model', 'condition')))
                future = asyncio.run_coroutine_threadsafe(backend.snapshot(query), loop)
                result = future.result(timeout=200)
                self.reply(200, dict(version=1, query=query, fetchedAt=datetime.now(timezone.utc).isoformat(), **result))
            except InventoryError as error:
                self.reply(400 if error.code == 'invalid_query' else 503, dict(error=error.code), error.retry_after)
            except concurrent.futures.TimeoutError:
                if future:
                    future.cancel()
                self.reply(504, dict(error='timeout'), 60)
            except Exception:
                self.reply(500, dict(error='internal_error'), 60)
    return Handler


def main():
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    backend = BrowserInventory()
    server = ThreadingHTTPServer(('0.0.0.0', 8080), handler_for(backend, loop))
    server.daemon_threads = True

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever()
    finally:
        asyncio.run_coroutine_threadsafe(backend.close(), loop).result(timeout=20)
        server.server_close()
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=5)


if __name__ == '__main__':
    main()
