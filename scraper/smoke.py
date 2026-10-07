"""Manual, read-only smoke check. Never logs VINs, cookies or sends notifications."""
import argparse
import json
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--model', choices=['m3', 'my'], default='m3')
parser.add_argument('--condition', choices=['new', 'used'], default='new')
parser.add_argument('--sample-schema', action='store_true')
args = parser.parse_args()
url = 'http://127.0.0.1:8080/inventory?' + urllib.parse.urlencode(dict(market='de', model=args.model, condition=args.condition))
try:
    with urllib.request.urlopen(url, timeout=210) as response:
        data = json.load(response)
except urllib.error.HTTPError as error:
    print(json.dumps(dict(status=error.code, error=json.load(error))))
    raise SystemExit(1)
print(json.dumps({key: value for key, value in data.items() if key != 'vehicles'} | dict(count=len(data['vehicles']))))
if args.sample_schema and data['vehicles']:
    row = data['vehicles'][0]
    fields = {key: row[key] for key in ('Model', 'TrimName', 'TRIM', 'PAINT', 'INTERIOR', 'InventoryPrice', 'PurchasePrice', 'CountryCode') if key in row}
    specs = row.get('OptionCodeSpecs', {})
    if isinstance(row.get('OptionCodeData'), list):
        fields['OptionCodeData'] = [item for item in row['OptionCodeData']
                                   if isinstance(item, dict) and item.get('group') in ('TRIM', 'PAINT', 'INTERIOR')]
    if isinstance(specs, dict):
        fields['OptionCodeSpecs'] = {key: specs[key] for key in ('TRIM', 'PAINT', 'INTERIOR') if key in specs}
    print(json.dumps(dict(sample=fields)))
