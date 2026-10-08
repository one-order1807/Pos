# ONEORDER — App Flow & Feature Reference

This file documents how the app actually works today, end to end, so anyone picking up the project
can understand the real workflow without reading every screen. It lives on its own branch
(`docs/flow`) rather than `master` so it can be updated as a living reference independent of
feature work. It is not a product spec or a wishlist — every feature described here is implemented
and in the current codebase.

ONEORDER is a **staff-operated** restaurant/café POS. There is no customer-facing ordering screen —
a staff member always takes the order on this device (or a second Chef Mode tablet handles the
kitchen side). "Self-service" in the sense of a customer placing their own order from their phone
or a table-side kiosk does not exist yet.

---

## 1. The core order → kitchen → bill flow

This is the one flow every order goes through, end to end:

1. **Start an order** (Order tab → "New Order"): staff picks **Dine-in**, **Takeaway**, or
   **Delivery** (`domain/ops.ts: createSession`). Dine-in orders are assigned a table (unless
   Table Mode is off, or the café uses the combined-bill single-tap flow — see §2).
2. **Add items**: tapping an item on the grid quick-adds it; tapping the item body opens a
   customization modal for quantity and a note (`ItemModal.tsx`). Items are organized by category
   with a search box that matches by name, code, or exact ID.
3. **Send the Cook Bill** (`sendCookBill`): every item added since the last send becomes a new
   **round**, consolidated into a `Ticket` and pushed to the Kitchen tab. The ticket also prints
   immediately on whichever printer is assigned the Cook Bill role (see §5). A dine-in order
   without a table assigned yet is blocked from sending with a "needs-table" error, unless the café
   runs the combined-bill flow.
4. **Kitchen processes the ticket** (Kitchen tab, `KitchenScreen.tsx`): tickets flow through three
   columns — **Pending** → **Cooking** (tap "Start Cooking" or, in the admin view, drag/reorder
   first) → **Ready**. Each ticket shows how long it's been waiting, color-coded (fresh / getting
   old / overdue), and can be reprinted at any point.
5. **Print the Customer Bill and pay** (`payAndClose`): once every line has been sent to the
   kitchen (no unsent items left), staff opens the bill, optionally attaches a customer name/phone
   (with occasion), picks a payment method (Cash / UPI / Card), and closes the order. The session
   is marked `paid`, GST and totals are computed and frozen onto it (`FinalTotals`), and if dine-in,
   the table becomes free again.
6. **Table frees up**: once paid, the table's status reverts to "available" and is ready for the
   next walk-in.

### Table status, derived live (`tableStatus()` in `domain/ops.ts`)
A table's status is never stored directly — it's computed from the session/ticket state every time
it's read, so it's always current and reacts instantly to the real-time sync below:
- **available** — no open session on this table.
- **occupied** — an open session exists, no ticket is currently pending/cooking, and the bill
  hasn't printed yet (order is open but nothing's in the kitchen right now).
- **cooking** — at least one ticket for this table's session is `pending` or `cooking`.
- **payment** — the Customer Bill has printed (`billPrintedAt` set) but the order hasn't closed yet.

## 2. Table Mode and the combined-bill shortcut
- **Table Mode** (Dev Mode toggle) turns the Tables tab on/off. With it off, every order is a plain
  tab (takeaway/delivery-style), no table picker.
- **Combined Bill Print** (Dev Mode toggle) is built for counter-service cafes: instead of picking
  a table up front and printing Cook/Customer bills separately, a single tap sends the Cook Bill,
  immediately opens the Customer Bill, records payment as Cash, and closes the order — table
  selection is skipped entirely.
- **Merging tables**: two or more free tables can be merged into one (e.g. pushing tables together
  for a large group); the merged table gets a combined label (`T-1M3` for a numeric run, or
  `A+B` otherwise) and acts as a single table for ordering until explicitly unmerged. A table with
  an open order can't be merged or deleted — it has to be freed (paid/closed) first.
- **Arrange mode** (Tables tab): drag tables around a free-form canvas to match the café's actual
  floor plan; add new tables, rename them, or remove ones that aren't locked by an open order.

## 3. Multi-round orders and the bill
- A dine-in tab can be sent to the kitchen multiple times as the group keeps ordering — each send
  is a new **round**, and the printed Cook Bill only ever shows the new items from that round.
- The Customer Bill consolidates every round's lines into one itemized bill (`consolidateLines`),
  with Item / Qty / Rate / Amount columns, computed GST, and the final total.
- **GST** is a configurable list of named percentage lines (e.g. SGST 2.5% + CGST 2.5%), not a
  single flat rate — printed as separate lines on the bill along with the GST registration number
  if one's set.
- **FSSAI number** is optional and only printed when set.

## 4. Kitchen (`KitchenScreen.tsx`) and Chef Mode
- Three live columns: **Pending** (newly sent, can be reordered by an admin before cooking starts),
  **Cooking** (currently being prepared), **Ready** (done, shown for up to 2 hours after).
- **Admin view**: pending tickets can be reordered via Up/Down buttons or by dragging the ticket's
  grip handle — useful when the kitchen wants to work tickets out of arrival order.
- **Chef Mode**: a PIN-gated, restricted mode meant for a second tablet physically in the kitchen.
  It replaces the whole app shell with just the Kitchen board (no tab bar, no way to reach
  Tables/Menu/Users/Dashboard/Dev Mode) plus the printer connection pill, and adds a one-tap
  "Start Cooking" / "Mark Ready" action chefs use directly. Exiting Chef Mode requires the exit PIN.
  Reordering controls are hidden in Chef Mode — a chef works tickets in the order they arrive.
- All of this is driven by the same shared data, so an order sent from the front counter shows up
  on the kitchen tablet immediately via the real-time sync below — no manual refresh.

## 5. Printing
- Thermal ESC/POS printing over Bluetooth LE (`react-native-ble-plx`), with a hand-rolled PNG
  decoder (for the café logo), QR renderer (e.g. a Google Review link), and BMP preview encoder.
- **Multiple printers at once**: each connected printer gets its own live connection status, and
  can be assigned a **role** — print both Cook and Customer Bills, or just one of the two. This is
  how a café with one printer at the counter and one in the kitchen splits the two bill types.
- **Remembered printers**: once connected, a printer's Bluetooth ID/name/role is saved to Settings
  and auto-reconnected on every app launch — no need to re-pair each time.
- **Bill templates**: multiple paper-width/column templates to choose from, with a live preview
  and test-print, independent of the printer connection itself.

## 6. Dashboard / analytics (`DashboardScreen.tsx`)
Sales, order count, and average order value for Today / 7 days / 30 days / All time or a custom
calendar range; order-type and payment-method splits; category sales as a donut chart; best-selling
items; a peak-hours chart (12h/24h); customer tiers (Gold/Silver/Regular, by all-time visits/spend)
with a top-5 list; and, when Table Mode is on, a live table-status panel showing every table's
current state at a glance, using the same color coding as the Tables tab.

## 7. Users / customers (`UsersScreen.tsx`)
Customers are keyed by phone number, captured at payment time. Visit history, name, and an optional
occasion (Birthday / Anniversary / Celebration / Other) are tracked per customer; typing a name at
checkout suggests existing matches so repeat customers aren't re-entered from scratch, with a
confirmation step if a name matches an existing record but the phone number doesn't.

## 8. Dev Mode (`DevModeScreen.tsx`)
The admin settings area, behind a PIN (`PinGate`): café name/address/phone/footer text, logo
upload (PNG only) and the Google-Review-style QR, GST configuration, FSSAI number, Table Mode and
Combined Bill Print toggles, printer management (see §5), bill template selection, and backup/
restore of the local database.

## 9. Sync and multi-device
- Local storage is SQLite on-device (`expo-sqlite`), the source of truth even with no network.
- An optional Firebase/Firestore backend (anonymous auth) mirrors changes across devices in real
  time via `onSnapshot` listeners — e.g. a table's status updates on the kitchen tablet the instant
  it changes at the counter, with no restart needed.
- Conflict resolution is **last-write-wins by embedded timestamp**, applied as atomic SQLite
  upserts — a real, named limitation, not a full CRDT system. Two devices editing the exact same
  record within the same moment can have one edit silently lose; this hasn't mattered in practice
  because screens are mostly complementary (counter vs. kitchen) rather than contending for the
  same record, but it's worth knowing about before relying on this for anything safety-critical.
  `firestore.rules` needs to be applied via the Firebase console before this touches real customer
  data in production.
- The app checks for in-app updates (`update/check.ts`) and prompts to apply them.

## 10. Branding
Splash screen, top bar, and app icon all use the "O1" monogram brand mark; the café's own name and
logo (uploaded in Dev Mode) appear on printed bills, not in the app's own chrome.

---

## Feature list (quick reference)

- Order types: dine-in (with table assignment/merging), takeaway, delivery
- Multi-round ordering with per-round Cook Bill tickets
- Combined single-tap bill flow for counter service
- Kitchen board: Pending → Cooking → Ready, with admin reordering and Chef Mode
- Chef Mode: PIN-gated, restricted second-tablet kitchen view
- Table layout editor (arrange/add/rename/delete/merge/unmerge), locked while a table has an order
- Live, color-coded table status, consistent across the Tables tab and Dashboard
- Multi-line GST, optional FSSAI number, configurable bill templates
- Multi-printer support with per-role (Customer Bill / Cook Bill / both) routing and auto-reconnect
- Logo and QR code printing on bills
- Customer tracking by phone number: visit history, occasions, name-matching at checkout
- Dashboard analytics: sales, orders, AOV, type/payment splits, category sales, best-sellers, peak
  hours, customer tiers, live table status
- Local SQLite persistence with optional real-time Firebase sync across devices (last-write-wins)
- Backup/restore of the local database
- In-app update check
- PIN-gated Dev Mode / admin settings
