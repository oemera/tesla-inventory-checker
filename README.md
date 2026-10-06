# Tesla Inventory Checker

Self-hosted watcher for new Tesla inventory in Germany. It polls Tesla through [`tesla-inventory`](https://github.com/teslahunt/inventory), matches saved vehicle profiles, and sends a Telegram and/or SMTP email notification only for a previously unseen matching vehicle.

It does not authenticate to Tesla, purchase, reserve, solve challenges, or bypass Tesla protections.

## How it works

1. One inventory request is made per unique market/model/condition combination; multiple profiles with the same Model 3 query do not multiply Tesla traffic.
2. The response is normalised to a stable internal vehicle structure.
3. Trim, exterior paint, interior, and maximum price are checked against each profile.
4. A local SQLite database records each profile/VIN pair.
5. The first successful run is a quiet baseline by default. Later matching vehicles produce one alert with Tesla's order URL.

The polling default is 60 seconds, with up to ten seconds of jitter. Do not lower it below 30 seconds. Tesla may change its undocumented inventory endpoint or restrict automated traffic; use responsibly and review Tesla's applicable terms.

### Verify the source before enabling alerts

The direct Tesla inventory API is undocumented. Before enabling the worker on the VPS, run the following from the checked-out release (or inside the image) to verify that the VPS can read Germany's current data:

```sh
npm run build
npm run live-check
```

If Tesla returns `HTTP 403`, the VPS is blocked from the direct endpoint. The application deliberately does **not** attempt to bypass Tesla challenges or bot protection. It will log the failure and send a technical alert after three consecutive failures. In that case, stop the worker and use a permitted data source or review the approach manually; do not increase the polling rate.

### Verify Telegram and email safely

After configuring `.env` and `profiles.json`, use the one-shot notification check. It sends a clearly labeled synthetic test vehicle and never contacts Tesla or writes the SQLite state.

```sh
npm run build
npm run test-notification
```

Inside the Docker image, run the same command as `node dist/test-notification.js` with your `.env` file and profile mounted.

## Configure

Copy the examples on the deployment host. Keep the real files out of Git.

```sh
cp .env.example .env
cp profiles.example.json profiles.json
mkdir state
chmod 600 .env
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for Telegram. Create the bot with BotFather and first send it a message. For email, set the SMTP values and use an app password where your provider supports it.

Every enabled profile must have at least one enabled notification channel whose credentials are configured. A profile is only notified when all populated filters match. Add Tesla's exact current labels as aliases; the defaults are examples and Tesla can rename trims, paints, and interiors.

`NOTIFY_ON_FIRST_SEEN=false` is deliberately the default: current stock becomes the baseline instead of creating a burst of old alerts. Set it to `true` for the first production run only if you want every already-available match reported.

## Run on a VPS

Before the first deployment, edit `compose.yaml` and replace `CHANGE-ME` with your lowercase GitHub owner or organisation. The project publishes its release images to GHCR after a Git tag such as `v0.1.0`.

```sh
docker compose pull
docker compose up -d
docker compose logs -f watcher
```

The service exposes no network port. It needs persistent write access only to `./state`; the configuration is mounted read-only. Pin the image in `compose.yaml` to a release version such as `:0.1.0` once the initial deployment works, rather than relying permanently on `:latest`.

For a private GHCR package, log the VPS into `ghcr.io` with a GitHub token that has package-read access before calling `docker compose pull`.

## Development and tests

Node 22.13 or later is required because persistence uses Node's built-in SQLite module.

```sh
npm ci
npm run check
npm test
npm run build
docker build --tag tesla-inventory-checker:test .
```

The test suite covers configuration validation, the `tesla-inventory` adapter contract for Germany, raw Tesla-response normalisation, profile matching, the SQLite deduplication path, and the quiet-first-run/new-VIN notification behaviour. Fixtures are local; CI never contacts Tesla.

When Tesla changes its response format, add a sanitised fixture that represents the new response, update `src/normalize.ts`, and make the test demonstrate the expected normalized fields before releasing an image.

## Release process

1. Merge a tested change into `main`.
2. Create and push a version tag, e.g. `v0.1.0`.
3. GitHub Actions builds and publishes `ghcr.io/<owner>/tesla-inventory-checker:0.1.0` for Linux AMD64.
4. Change the image tag in the VPS `compose.yaml`, then run `docker compose pull && docker compose up -d`.
