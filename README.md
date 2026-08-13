# PlantDaddy

A personal web app for watering and fertilizing houseplants. SvelteKit (Svelte 5
with runes, TypeScript) + PostgreSQL, with **no accounts**: a session is a UUID
token the user keeps.

Status: **Phase 7** — installable PWA, working push notifications, deploy files
ready for Dokploy.

> **Vibecoded end to end with Claude Opus.** Every line of this project — schema,
> API, frontend, service worker, Dockerfile, docs — was written by Claude Opus in
> a phased conversation, with a human reviewing and approving each phase before
> the next one started. The in-code comments are in Italian because that is the
> language the project was built in; they explain _why_ a choice was made, not
> what the line does.

## What it does

- **No login.** First launch generates a UUID v4, shown as text and as a
  downloadable QR code. Paste the code — or upload a photo of the QR — to restore
  the session on another device.
- **One tap to log care.** The main view is "what needs doing today"; a single
  tap on _Annaffiata_ / _Concimata_ records the event with today's date, with an
  optimistic update so the card reacts before the network does.
- **Backdated entries** live behind a separate, visually secondary button, so
  they never get in the way of the fast path.
- **Snooze** ("not today, remind me tomorrow") does not create a care event and
  does not distort the history: it only moves the date the plant comes back.
- **Event history**, not just "last watered": every watering and feeding is a
  row, dates are always _derived_ from it, and deleting an event automatically
  rolls the due date back to the previous one.
- **Winter mode**: a manual global flag that multiplies every interval by a
  configurable factor (default 1.5), with a permanent indicator so you don't
  forget it's on in May.
- **Daily push summary**: one notification per user, at the hour they chose, with
  quick actions handled by the service worker without opening the app.
- **Backup**: JSON export and import (merge or replace), because with no account
  a lost code would mean lost data.

## Push notifications: what each platform needs

| Platform                         | How to install                                               | Push                                |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| Chrome / Edge (Android, desktop) | native prompt in one tap, or the install icon in the URL bar | yes, even in a normal tab           |
| **Safari on iOS / iPadOS**       | Share → Add to Home Screen (no API exists; three taps)       | **only once installed**, iOS ≥ 16.4 |
| Chrome / Firefox on iOS          | cannot install: only Safari has "Add to Home Screen"         | no                                  |
| Firefox desktop                  | does not install PWAs                                        | no                                  |

> **On iPhone and iPad, push only works if PlantDaddy has been added to the Home
> Screen.** From a regular Safari tab `Notification.requestPermission()` does not
> even work, which is why the "Attiva" button in Settings is disabled with an
> explanation instead of failing silently. Requires iOS 16.4 or later.

Chrome's installability criteria are met and verified: `name`, `short_name`,
`start_url`, `display: standalone`, 192px and 512px icons plus a `maskable` one,
a registered service worker with a `fetch` handler, and HTTPS (`localhost`
counts in development).

### Notification cron

`GET /api/cron/notify` must be called **every hour**: each user gets their
notification at the hour stored in `notify_hour`.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/notify
```

The secret is compared with `timingSafeEqual`, and rejection happens **before
any database query**, so the endpoint can't be turned into a DoS amplifier. The
same run deletes expired action tokens and any subscription that answers
404/410.

To test another hour by hand: `?hour=9` (still behind the secret).

## Layout

```
src/
  app.css                  tokens, layout, shared primitives, animations
  app.html                 shell (no inline styles: the CSP forbids them)
  hooks.server.ts          session resolution + log scrubbing
  lib/
    api.ts                 fetch wrapper with the X-Session-Token header
    motion.ts              durations, easings and prefers-reduced-motion
    qr.ts                  QR generation (qrcode) and decoding (jsqr)
    components/            Logo, PlantCard, CareButton, BottomSheet, Timeline…
    stores/                session, plants, install, push, toasts (runes in classes)
    server/                db, auth, zod schemas, push allowlist, rate limit, notify
  routes/
    +layout.svelte         shell, bottom nav, View Transitions
    +layout.ts             ssr = false
    /                      Home: what to care for today
    /piante                full list + new plant
    /piante/[id]           detail, history, statistics
    /benvenuto             session creation, token, QR
    /ripristina            restore from a code or a QR image
    /impostazioni          season, notifications, session, backup
    /api/…                 15 server routes
db/
  migrations/              001_init.sql, 002_action_tokens.sql
  verify.sql               schema self-check, runs inside a ROLLBACK
static/
  manifest.webmanifest     PWA manifest
  sw.js                    service worker: push, notificationclick, minimal fetch
  icons/                   192, 512, maskable 512, apple-touch 180
```

## Requirements

- Node **24.13.1** (see `.nvmrc`): `nvm use`.
  Node ≥ 22.13 is the real floor, because the ESLint 10 stack requires it, and
  ≥ 22.6 because `npm run migrate` runs TypeScript natively, without `tsx`.
- PostgreSQL ≥ 13 (uses `gen_random_uuid()` without the `pgcrypto` extension).

## Setup

```bash
nvm use
npm install
cp .env.example .env    # then fill in DATABASE_URL
```

### Generating the VAPID keys (push notifications)

```bash
npx web-push generate-vapid-keys
```

Put the public key in `PUBLIC_VAPID_PUBLIC_KEY` and the private one in
`VAPID_PRIVATE_KEY`. In SvelteKit only variables prefixed with `PUBLIC_` are
exposed to the client, so the private key stays on the server. Generate them
once and keep them: rotating the keys invalidates every existing subscription,
because browsers encrypted against the old public key.

`VAPID_SUBJECT` is a contact address required by push services (`mailto:...` or
the site URL). For the cron secret:

```bash
openssl rand -hex 32
```

### Creating the database locally

```bash
createdb plantdaddy
```

## Migrations

Versioned migrations live in `db/migrations/` as numbered files (`001_init.sql`).
The script reads the folder in order, skips versions already recorded in
`schema_migrations`, and runs each file inside a transaction — Postgres has
transactional DDL, so a migration that fails halfway leaves no debris.

```bash
npm run migrate
```

It is idempotent: running it again applies nothing. To change the schema, add a
new file (`003_...sql`); never edit one that has already run.

### Verifying the schema

```bash
psql "$DATABASE_URL" -f db/verify.sql
```

It checks the `plant_status` view, snooze precedence, the automatic rollback of
derived dates when an event is deleted, the 300-event FIFO rotation, and
double-tap idempotency. It runs inside a transaction that ends in `ROLLBACK`, so
it leaves no data behind and is safe to run against the development database.

## Development

```bash
npm run dev          # http://localhost:5173
npm run check        # svelte-check + TypeScript
npm run lint         # prettier --check + eslint
npm run format       # prettier --write
npm run build        # production build (adapter-node)
node build/index.js  # run the build
```

`mockup.html` is the interactive prototype the UI was approved from: a single
self-contained file, no build step, opens straight in a browser. The logo source
is `logo.svg`.

## Deployment

See [DEPLOY.md](DEPLOY.md) — step-by-step Dokploy instructions, written for a VPS
that already hosts other Dokploy projects, including the isolation rules and the
post-deploy checks that verify from **outside** the box that no port got
published by accident.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — **free for noncommercial use, paid for
commercial use.**

- Run it for yourself, your family, your friends, for free. Fork it, study it,
  modify it. Charities, schools, universities and public institutions are covered
  too.
- Charging for access, selling it as part of a product or service, deploying it
  inside a company, or **monetising it with advertising** requires a paid license
  from the author. See [COMMERCIAL.md](COMMERCIAL.md).

Note that this is a source-available license, not an OSI-approved open-source
one: GitHub displays it as "Other", and some organisations decline noncommercial
licenses on principle. That is the deliberate trade-off.

## Architecture notes

Each of these is a decision with a reason, not a preference.

- **Session token**: only the hex SHA-256 of the token is stored, never the UUID
  itself. The client keeps the UUID, the server hashes it on every request and
  compares. A database dump exposes no sessions. The hash is fast and unsalted on
  purpose: a UUID v4 carries 122 bits of entropy and is not brute-forceable —
  bcrypt/argon2 exist to slow down attacks on low-entropy passwords.
- **No `last_watered` column**: last-care dates are derived from `care_events` in
  the `plant_status` view, so deleting an event rolls the schedule back to the
  previous one with no application-level undo logic.
- **Quotas**: 300 events per plant, enforced by a trigger that rotates FIFO and
  deletes the _oldest_ (≈5 years of weekly history). Deleting the newest would
  throw away the watering just recorded and leave "last watered" permanently
  behind. 100 plants per user is enforced in the application with an explicit 409. Both exist so the shared disk volume can't be filled by row spam.
- **`src/lib/server/`**: SvelteKit forbids importing this folder from client code
  at compile time, so the database connection string can't end up in a browser
  bundle even by mistake.
- **Config lives in `vite.config.ts`**: with SvelteKit 2.70 and
  `vite-plugin-svelte` 7 there is no `svelte.config.js` any more. Kit options —
  adapter and `csp` included — are passed to the `sveltekit()` plugin, which
  splits them from the Svelte plugin's own.
- **CSP**: `script-src 'self'` plus a nonce, no `unsafe-inline`. Styles are split:
  `style-src-elem 'self'` (no injectable `<style>`) and
  `style-src-attr 'unsafe-inline'`, which is needed because SvelteKit injects its
  own screen-reader announcer div with an inline clipping style. In development
  Vite adds `unsafe-inline` to `style-src` to hot-inject CSS; the production
  build does not have it.
- **No `{@html}` anywhere**: plant notes are rendered as text and Svelte escapes
  them. With the token in localStorage, an XSS would be full account compromise,
  so the one construct that could introduce one is simply absent.
- **Token stored twice**: localStorage plus a `SameSite=Lax` cookie with a
  400-day lifetime, read with mutual fallback — Safari can evict site storage
  after weeks of inactivity, and "clear data" on Android wipes it. The cookie
  **never authenticates**: the server only reads the `X-Session-Token` header,
  and that is exactly what makes the app immune to CSRF, since a third-party site
  cannot set a custom header cross-origin.
- **Single-use action tokens for notification quick actions**: a service worker
  cannot read localStorage, and the session token must not travel in a push
  payload — it is encrypted in transit but then stored in the notification object
  on the device, where a permanent credential is a gift to whoever picks up the
  phone. Each notification instead carries a token valid for one plant, one
  action and 24 hours (`action_tokens`, hash only). The service worker calls
  `POST /api/quick-action` with that and nothing else.
- **Quick actions only when a single plant is due**: with three plants pending,
  "Annaffiata" wouldn't know which one to water, so the notification omits them.
  iOS ignores `actions` and opens the app anyway: an accepted degradation, with
  no code written to work around it.
- **Static service worker** (`static/sw.js`), registered manually rather than
  SvelteKit's generated one, which is built for asset precaching. Here only push,
  `notificationclick` and a minimal `fetch` handler are needed — the last one
  purely because Chrome requires a registered `fetch` listener for
  installability. **No offline cache**: this app needs the database to be useful,
  and a page cache would show stale data as if it were current.
- **`manifest.webmanifest`, not `.json`**: sirv maps that extension to the
  recommended `application/manifest+json` MIME type.
- **`min-height: 100dvh` on the app shell**: percentage heights depend on every
  ancestor having a defined height, and when that chain breaks the bottom nav
  floats up into the middle of an empty page. `dvh` looks only at the viewport
  and accounts for mobile browser chrome appearing and disappearing.
- **Animations only on `transform` and `opacity`**, durations in one place
  (`src/lib/motion.ts`, mirroring the CSS variables), and
  `prefers-reduced-motion` read once and applied centrally instead of being
  re-checked in every component.

