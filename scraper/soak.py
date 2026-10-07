"""Explicitly invoked bounded read-only soak. No Telegram, SMTP or SQLite."""
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--cycles', type=int, default=60)
parser.add_argument('--interval', type=int, default=60)
args = parser.parse_args()
if not 1 <= args.cycles <= 10000 or args.interval < 60:
    parser.error('cycles must be 1..10000; interval must be at least 60 seconds')
failed = 0
for cycle in range(args.cycles):
    delay = args.interval
    for model, condition in [('m3', 'used'), ('m3', 'new'), ('my', 'new')]:
        url = 'http://127.0.0.1:8080/inventory?' + urllib.parse.urlencode(dict(market='de', model=model, condition=condition))
        try:
            with urllib.request.urlopen(url, timeout=210) as response:
                data = json.load(response)
            print(json.dumps(dict(cycle=cycle + 1, model=model, condition=condition, count=len(data['vehicles']),
                complete=data['complete'], pages=data['pages'], session=data['sessionGeneration'])), flush=True)
        except urllib.error.HTTPError as error:
            retry = error.headers.get('Retry-After', '')
            delay = max(delay, int(retry) if retry.isdigit() else 300)
            failed += 1
            print(json.dumps(dict(cycle=cycle + 1, status=error.code, error='http_error')), flush=True)
            error.close()
            break
        except Exception:
            failed += 1
            delay = max(delay, 300)
            print(json.dumps(dict(cycle=cycle + 1, error='transport_error')), flush=True)
            break
    if cycle + 1 < args.cycles:
        time.sleep(delay)
print(json.dumps(dict(cycles=args.cycles, failed=failed)), flush=True)
raise SystemExit(1 if failed else 0)
