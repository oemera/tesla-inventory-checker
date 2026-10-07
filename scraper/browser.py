import asyncio
import json
import os
import signal
import socket
import tempfile
import time
import urllib.parse
import urllib.request

from inventory import InventoryError, collect_pages, countrywide_template, retry_after
from sandbox import require_sandbox, verify_browser_sandbox


class BrowserInventory:
    def __init__(self):
        self.browser = None
        self.chrome = None
        self.display = None
        self.temp = None
        self.templates = {}
        self.created = 0
        self.generation = 0
        self.cooldown_until = 0
        self.lock = asyncio.Lock()
        self.last_success = None
        self.last_error = None
        self.sandbox_status = None

    async def close(self):
        if self.browser:
            self.browser.stop()
            self.browser = None
        for process in (self.chrome, self.display):
            if process and process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    await asyncio.wait_for(process.wait(), 5)
                except asyncio.TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
                except ProcessLookupError:
                    pass
        self.chrome = self.display = None
        if self.temp:
            self.temp.cleanup()
            self.temp = None
        self.templates.clear()
        self.sandbox_status = None

    async def start(self, *, warmup=True):
        require_sandbox()
        await self.close()
        try:
            await self._launch()
            self.sandbox_status = await verify_browser_sandbox(self.browser)
            if warmup:
                await self.browser.get('https://www.tesla.com/de_DE')
                await asyncio.sleep(5)
            self.created = time.monotonic()
            self.generation += 1
        except BaseException:
            await self.close()
            raise

    async def _launch(self):
        import nodriver as uc
        self.temp = tempfile.TemporaryDirectory(prefix='tesla-session-', ignore_cleanup_errors=True)
        environment = dict(os.environ, DISPLAY=':99')
        self.display = await asyncio.create_subprocess_exec(
            'Xvfb', ':99', '-screen', '0', '1280x900x24', '-nolisten', 'tcp',
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
        await asyncio.sleep(1)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        command = [os.getenv('CHROME_BINARY', 'google-chrome'),
                   f'--user-data-dir={self.temp.name}/profile', f'--remote-debugging-port={port}',
                   '--remote-debugging-address=127.0.0.1', '--no-first-run',
                   '--no-default-browser-check', '--window-size=1280,900']
        self.chrome = await asyncio.create_subprocess_exec(
            *command, 'about:blank', env=environment, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL, start_new_session=True)

        def ready():
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as response:
                    return json.load(response)
            except Exception:
                return None

        for _ in range(25):
            if await asyncio.to_thread(ready):
                break
            if self.chrome.returncode is not None:
                raise InventoryError('browser_start_failed')
            await asyncio.sleep(1)
        else:
            raise InventoryError('browser_start_timeout')
        self.browser = await uc.start(host='127.0.0.1', port=port)

    async def prepare(self, query):
        import nodriver as uc
        key = (query['model'], query['condition'])
        if key not in self.templates:
            page = await self.browser.get('about:blank')
            urls = []

            async def capture(event):
                url = urllib.parse.urlparse(event.request.url)
                if url.scheme == 'https' and url.netloc == 'www.tesla.com' and url.path == '/inventory/api/v4/inventory-results':
                    urls.append(event.request.url)

            page.add_handler(uc.cdp.network.RequestWillBeSent, capture)
            await page.send(uc.cdp.network.enable())
            await page.get(f'https://www.tesla.com/de_DE/inventory/{query["condition"]}/{query["model"]}')
            await asyncio.sleep(10)
            body = (await page.evaluate('document.title + "\\n" + document.body.innerText')).lower()
            if any(word in body for word in ('access denied', 'verify you are human', 'unusual traffic', 'bestätigen sie, dass sie ein mensch')):
                raise InventoryError('access_blocked', 900)
            if not urls:
                raise InventoryError('inventory_query_not_observed')
            try:
                template = json.loads(urllib.parse.parse_qs(urllib.parse.urlparse(urls[-1]).query)['query'][0])
                actual = template['query']
            except (ValueError, KeyError, TypeError):
                raise InventoryError('schema_changed') from None
            if any(actual.get(key) != value for key, value in query.items()):
                raise InventoryError('query_mismatch')
            self.templates[key] = countrywide_template(template, query)
        url = f'https://www.tesla.com/de_DE/inventory/{query["condition"]}/{query["model"]}'
        cookies = await self.browser.main_tab.send(uc.cdp.network.get_cookies(urls=[url]))
        return self.templates[key], {cookie.name: cookie.value for cookie in cookies}, url

    async def snapshot(self, query):
        async with self.lock:
            remaining = self.cooldown_until - time.monotonic()
            if remaining > 0:
                raise InventoryError('cooldown', int(remaining) + 1)
            try:
                result = await asyncio.wait_for(self._snapshot(query), 180)
                self.last_error = None
                self.last_success = time.time()
                return result
            except InventoryError as error:
                self.last_error = error.code
                self.cooldown_until = time.monotonic() + max(error.retry_after, 60)
                await self.close()
                raise
            except asyncio.CancelledError:
                await self.close()
                raise
            except Exception:
                self.last_error = 'transport_or_browser_error'
                self.cooldown_until = time.monotonic() + 60
                await self.close()
                raise InventoryError(self.last_error, 60) from None

    async def _snapshot(self, query):
        from curl_cffi import requests
        session_age = int(os.getenv('SESSION_MAX_AGE_SECONDS', '1800'))
        for attempt in range(2):
            if not self.browser or time.monotonic() - self.created >= session_age:
                await self.start()
            template, cookies, referer = await self.prepare(query)

            async def fetch(payload):
                response = await asyncio.to_thread(
                    requests.get, 'https://www.tesla.com/inventory/api/v4/inventory-results',
                    params={'query': json.dumps(payload)}, cookies=cookies, impersonate='chrome131',
                    timeout=25, allow_redirects=False, headers={'Accept': 'application/json, text/plain, */*', 'Referer': referer,
                                         'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin'})
                if response.status_code in (401, 403):
                    raise InventoryError('session_rejected', 900)
                if response.status_code == 429:
                    raise InventoryError('rate_limited', retry_after(response.headers.get('retry-after', '')))
                if response.status_code != 200:
                    raise InventoryError('upstream_error', 60)
                try:
                    return response.json()
                except ValueError:
                    raise InventoryError('schema_changed') from None

            try:
                rows, pages = await collect_pages(template, query, fetch)
                return dict(vehicles=rows, complete=True, pages=pages, sessionGeneration=self.generation)
            except InventoryError as error:
                if error.code == 'session_rejected' and attempt == 0:
                    await self.close()
                    continue
                raise
