# Changelog

One short entry per release: what changed, what was fixed, and the version it shipped in. This is
the answer to "what changed, is this done, what's in this build" going forward — keep it updated
every round rather than reconstructing it from chat history later.

## v1.6.0 — 2026-10-09 (first-launch device activation)

- Added: the app now gates first launch behind a one-time access key - a branded screen (reusing
  the existing logo) asking for the key, shown once per device until it's redeemed
  (`src/ui/ActivationGate.tsx`, `src/activation/activate.ts`, `store.ts`'s `activated`/`activate`).
  Requires network access to a configured backend (`EXPO_PUBLIC_BACKEND_URL`) at activation time -
  there's no offline fallback. See the Phase-2-backend branch's `backend/README.md` for how the key
  is generated (`gen_key.py`) and verified (`POST /activate`).

## v1.5.0 — 2026-10-09

- Version bump only, no functional changes since v1.4.0 - published as a release checkpoint for
  this single-app track, kept separate from the admin/waiter split being developed on another
  branch.

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
