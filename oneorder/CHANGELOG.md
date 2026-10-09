# Changelog

One short entry per release: what changed, what was fixed, and the version it shipped in. This is
the answer to "what changed, is this done, what's in this build" going forward — keep it updated
every round rather than reconstructing it from chat history later.

## v3.1.0 — 2026-10-09 (QR table ordering)

- Added: Dev Mode → **QR Code Management** (`src/screens/QrManagementScreen.tsx`) - generates a
  unique ordering QR code and link per table, fetched dynamically from the Tables section (no
  manual entry). Copy one link or all of them at once, regenerate a table's QR (invalidating the
  old one immediately), and export a print-ready PDF with every table's QR labelled by table
  number (`expo-print` + `expo-clipboard`, new dependencies). Deleting a table now also revokes
  its QR automatically - hooked into the existing `saveTables` save point in `store.ts`, not a
  separate step to remember.
- Added (`backend/`): real table/menu sync, QR token mint/revoke/regenerate, and public customer
  order intake (`GET /t/{token}`, `POST /orders`, `GET /orders/{id}`) - server-side price
  validation (never trusts the customer's cart), idempotency-key deduplication, and a background
  job that mirrors a confirmed order into the *same* Firestore documents the app already listens
  to, so it appears in Kitchen/Dashboard with no app-side sync changes. A reconciliation sweep
  (every 5 minutes, `scheduler.py`) catches anything that didn't make it across after an outage.
- Added: `customer-web/` - a new static site a customer lands on after scanning a table's QR.
  Browse the menu (search + category filter), build a cart (persists across a refresh via
  `localStorage`, scoped per table), place an order, see live-ish confirmation status. White,
  blue-primary theme matching the admin app's own design system (Instrument Serif / Work Sans),
  animated with Framer Motion, mobile-first. No login, no payment collection - billing stays
  entirely in the existing POS workflow once the order lands.
- Added: `backend/Caddyfile` + a `caddy` container - reverse-proxies `/api/*` to `api` and serves
  `customer-web`'s build on the same origin (no CORS, no hardcoded domain in the frontend build),
  with automatic HTTPS for whatever `PUBLIC_BASE_URL` a deployment sets.
- Deliberately not in this release (flagged, not silently dropped): live "Preparing/Ready" ticket
  status pushed to the customer page (it polls order status, which only distinguishes "received"
  from "with the kitchen" - the full version needs a Firestore-listener-to-WebSocket bridge, the
  single most complex piece here); the restaurant's logo on the customer landing page (shows the
  name only - threading the app's own bill logo through needs a new migration); and actually
  deploying any of this to a real server/domain.

## v2.2.0 — 2026-10-09 (multi-tenant backend + first-launch device activation)

- Added: the backend (`backend/`) now has a real multi-tenant schema - `organizations`, `devices`,
  `activation_keys` - and a working `POST /activate` endpoint. One shared Postgres instance serves
  every client; each client gets its own deployment (own `ORG_ID`/`ORG_NAME` in its `.env`), and
  every row a deployment writes is tagged with its own org - never one a request supplies. See
  `backend/README.md`'s "Multi-tenancy" section.
- Added: `backend/api/gen_key.py`, a server-side CLI (`docker compose run --rm api python
  gen_key.py`) that generates a one-time, time-limited (10 min default) access key for a client
  deployment. Codes are stored as a SHA-256 hash only, never in plaintext.
- Added: the app now gates first launch behind that access key - a branded screen (reusing the
  existing logo) asking for the key, shown once per device until it's redeemed, the same way on
  both the admin and waiter builds (`src/ui/ActivationGate.tsx`, `src/activation/activate.ts`,
  `store.ts`'s `activated`/`activate`). Requires network access to the configured backend
  (`EXPO_PUBLIC_BACKEND_URL`) at activation time - there's no offline fallback.
- Added: `GET /admin/orgs` and `GET /admin/orgs/{org_id}/devices` - cross-client visibility (which
  clients exist, device counts, app versions) for internal use only. 403s unless `ADMIN_TOKEN` is
  explicitly set on a deployment - never set it on a deployment a client app can reach.

## v2.1.0 — 2026-10-09 (ONE-ORDER rebrand, admin/waiter split, backend scaffold)

- Changed: rebranded to ONE-ORDER; this branch now builds and ships **two separate Android apps**
  from the same codebase - the admin/counter app (`com.oneorder.pos`) and a waiter-only app
  (`com.oneorder.pos.waiter`), selected at build time via `APP_VARIANT` (see `app.config.js`) and
  built as a matrixed CI job (see `.github/workflows/build-apk.yml`) so both install side by side
  on the same device without colliding. Each variant checks for updates against its own channel.
- Added: infrastructure scaffold for the Phase 2 backend (`backend/`) - Postgres, Redis, a FastAPI
  `api` container, `worker`/`scheduler` background-job containers, and Alembic migrations wired up
  (no real schema or endpoints yet beyond a `/health` check - see `backend/README.md`). Not wired
  to the app yet; the app still runs on local SQLite plus the existing optional Firebase sync.

## v1.5.0 — 2026-10-08 (Waiter Mode, Phase 1)

- Added: Waiter Mode. Dev Mode gets a Waiter Mode toggle and waiter account management (username,
  password, a per-waiter "can print the Customer Bill" permission, and an active/disabled switch).
  When enabled, a "Waiter login" button appears on the main screen; logging in switches that
  device into a restricted, mobile-friendly, dine-in-only view with two sections - Order (pick a
  table, take the order, send it to the kitchen - reusing the same item grid and cart as the main
  Order tab) and Status (that waiter's own tickets, Pending → Cooking → Ready, with a "Served"
  button once food is delivered). Logging out just needs a tap and confirm.
- Added: the Customer Bill permission is enforced at the one real print function itself, not just
  a hidden button, so it can't be bypassed through the combined-bill-print path either. Cook Bill
  printing is unaffected for every waiter - only the customer-facing bill is restricted.
- Added: a waiter gets a notification (sound + vibration, configurable in Dev Mode, including an
  optional repeat interval) the moment the kitchen marks one of their own tickets ready - fires
  correctly regardless of which device/tablet actually marked it ready.
- Added: every order now records which waiter opened it (blank for the normal counter/admin flow);
  the Dashboard's order detail view shows that waiter's name and the full sent → cooking → ready →
  served timing trail for the order's tickets.
- Known gaps, flagged rather than silently skipped: no "Cancelled" ticket status yet; the
  Order/Status switch is tap-based, not a swipeable pager; notification sound is the Android
  system default tone, not a custom ringtone. All reasonable follow-ups, not needed for this round.

## v1.4.0 — 2026-10-08 (Round 7)

- Added: Printer panel now shows a "Remembered printers" section for known printers that are off
  or out of range right now (not currently connected and not in an active scan), each with a direct
  Reconnect button - previously the only way back to a known printer was starting a fresh scan.
- Changed: deleting a table in Arrange mode is now drag-the-table-onto-the-bin-icon instead of
  tapping a small trash icon on the card, with a dedicated bin drop target at the bottom of the
  screen - replaces the old per-card tap-to-delete entirely.
- Changed: Chef Mode's Kitchen view no longer shows the Up/Down reorder buttons or the drag handle
  on pending tickets - a chef works tickets in the order they arrive. The admin Kitchen view keeps
  both reordering controls, unchanged.
- Changed: table/order status colors are now consistent everywhere (Tables tab, Table Picker,
  Dashboard's live table panel) and color-blind-friendlier for this app's convention - free is
  neutral gray, occupied is green, cooking is orange, payment-pending is red. Previously `available`
  vs. everything else was the only distinction drawn on the Tables/Table-Picker screens, and the
  Dashboard panel disagreed with itself (its color-coded dots and its summary counts used two
  different color schemes for the same four statuses).
- Added: `FLOW.md` on a new `docs/flow` branch - documents the real end-to-end order → kitchen →
  bill workflow and a full feature list, as a living reference independent of feature work.

## v1.3.1 — 2026-10-02

- Fixed: uploading a logo in Dev Mode (Bill setup) could fail with "Not a PNG file" even for a
  real PNG - the decoder only handled the single most common PNG export shape (8-bit, non-
  interlaced). It now also handles 16-bit PNGs and Adam7-interlaced PNGs, both common exports from
  image editors. The file picker is now also restricted to PNG specifically (was any image type),
  so a JPEG/HEIC/WebP can't be selected in the first place only to fail on upload - the hint text
  next to the upload button now says exactly what's expected (PNG only, any size).

## v1.3.0 — 2026-10-02 (Round 6)

- Fixed: QR code on printed bills is smaller (less raster data sent to the printer, which was
  visibly stalling mid-print on larger QR codes).
- Fixed: the bill footer printed "?" instead of "x" between the café name and ONEORDER - thermal
  printers only support a legacy ASCII-ish character set, so the separator is now a plain "x" in
  everything sent to the printer (on-screen text is unaffected).
- Added: support for multiple printers connected at once, each with its own real connection status
  shown in the Order tab, and a Dev Mode role assignment (which printer gets the Cook Bill vs. the
  Customer Bill).
- Added: real-time sync between devices via Firestore listeners (previously push-only, with no way
  for a second device to see another device's changes without restarting the app). Conflict
  resolution is last-write-wins by timestamp - a real, named limitation, not a full CRDT system.
  Needs `firestore.rules` applied via the Firebase console before going near real customer data.
- Added: Chef Mode - a restricted, password-gated view (Kitchen + printer connection only) for
  running this same app on a second tablet in the kitchen, with Start Cooking / Mark Ready controls
  that live-update table status on every connected device (depends on the real-time sync above).
- Fixed: a wide per-unit price could overflow the Rate column and misalign the line after it.
- Fixed: deleting a table that's merged into another table showed a misleading "has an active
  order" error - it now says it's part of a merge and needs unmerging first.
- Added: this changelog.

## v1.2.1 — 2026-10-02

- Fixed the actual cause of the recurring bill-scroll bug: `Modal` was unconditionally wrapping its
  content in its own `ScrollView`, so the bill preview's own scroll container was always nested
  inside a second one - same-axis nested ScrollViews are unreliable on Android regardless of
  `nestedScrollEnabled`. Every previous attempt had only touched the inner component and missed
  this outer wrapper.
- Bill auto-scroll-to-bottom is now a custom-duration eased animation (slow and smooth) instead of
  the native `scrollToEnd`, which gave no control over speed and read as an abrupt jump.
- Fixed a real overflow bug in the Rate column added in v1.1.0: it used a fixed width while the
  Amount column was already sized from the real data - a wide unit price could overflow the line
  and misalign every column after it.

## v1.2.0 — 2026-10-01

- New brand mark (the "O1" monogram) across the Splash screen, the app's top bar, the floating
  bubble, and all app icon assets.

## v1.1.0 — 2026-10-01 (Round 5)

- Combined Cook+Customer Bill toggle is now a true single tap (prints both, records payment as
  Cash, closes the order) with table selection skipped, matching Table Mode off.
- Customer Bill form suggests matching existing customers while typing a name, with an explicit
  confirmation when a name matches but the phone doesn't.
- Birthday/Anniversary bill line is generic now, no customer name on the printed line.
- Removed "Cloud Build" from every printed bill footer.
- Users tab: tapping a row opens visit history instead of an inline edit form.
- Bill templates print a Rate column (Item / Qty / Rate / Amount), not just quantity and amount.
- Dashboard: added a calendar date/range picker alongside the existing presets.
- Dev Mode: optional FSSAI number field, printed only when set.
- GST rebuilt as a multi-line type + percentage list (SGST/CGST etc.) instead of one flat rate.
- App version shown in the Splash screen and the top bar, not just Dev Mode.
