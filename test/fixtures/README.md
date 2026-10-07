# Inventory fixtures

- `tesla-inventory-response.json`: original synthetic adapter/matching fixture.
- `tesla-used-de-sanitized.json`: selected public fields observed in the NAS live
  test on 2026-10-07 (Europe/Berlin). VIN replaced with a synthetic identifier;
  options and option-code list reduced to the three selected design/trim entries.
  Prices and descriptions preserve the observed format. This is not a full
  response and does not establish mappings for currently unavailable new trims.

Never store browser cookies, account tokens, customer data or personal browser
profiles in fixtures. Live tests do not run in CI.
