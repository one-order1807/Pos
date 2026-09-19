# ONEORDER — Complete Feature & Workflow Specification

This document is written to be handed directly to an AI developer (or a human one) to build from — every feature, every screen, and a worked example of the exact workflow, so nothing is left to guesswork. Read this fully before writing any code. Build one piece, verify it actually works, then move to the next — never chain untested features together.

Companion documents:
- **ONEORDER-Tables-Kitchen-Portal-Spec.md** covers the Tables section, the Table Mode toggle, and the Kitchen Portal in full depth — this document covers everything else.
- **ONEORDER-Tech-Stack.md** is the short hand-off version of Part J.

---

## PART A — What This Is

**ONEORDER** — a tablet-first café POS (10–11 inch tablets, the primary and only target device size for this build). A customer sits down, staff take the order, a Cook Bill prints for the kitchen, more items can be added as the visit continues, and one Customer Bill closes it out at the end.

---

## PART B — Design System

> This replaces any earlier warm-brown/espresso palette discussed previously — the direction now is a clean white base with blue as the primary color, colorful accents throughout, modeled on the polish of well-known, best-in-class consumer apps (clean cards, confident color, nothing cluttered). If a specific reference app was meant and got lost in translation, say the name and it'll be matched exactly — until then, this is the concrete interpretation to build against.

**Color palette:**

| Token | Color | Use |
|---|---|---|
| Background | White `#FFFFFF` / very light blue-gray `#F5F8FC` | page background |
| Primary | Blue `#2563EB` | primary buttons, active tab, headings |
| Primary Dark | `#1E40AF` | pressed states, emphasis |
| Accent 1 | Teal `#14B8A6` | secondary highlights, one chart color |
| Accent 2 | Amber `#F59E0B` | attention states, a second chart color |
| Accent 3 | Coral `#F97316` | a third chart/category color, keeps the dashboard feeling colorful rather than monochrome |
| Success/Available | Green `#22C55E` | free table, confirmed action |
| Danger/Occupied | Red `#EF4444` | occupied table, blocking warning |
| Muted | Soft gray-blue `#EAF1FB` | skeleton loading, subtle fills, card backgrounds |
| Radius | `0.75rem` on cards and buttons | consistent soft rounding, light mode only |

**Fonts:** Headings — **Instrument Serif** (elegant, editorial — café name, section titles, big dashboard numbers). Body/UI — **Work Sans** (clean, friendly — everything else: menu items, buttons, labels, table text).

**Startup animation** (pure CSS/SVG, ~1 second, tap anywhere to skip, plays once per session):
- A coffee cup drawn as an SVG outline in the primary blue, with a side handle.
- Coffee "fills" the cup from the bottom using a clip-path rectangle animating `scaleY` 0 → 1 over 0.9s ease-out, filled in the accent teal or amber.
- Three steam wisps above the cup — small rounded bars looping upward and fading out, rising ~30px, staggered at 0s / 0.15s / 0.3s.
- The café name fades in below with an 8px rise + fade, 0.4s delay.
- Full-screen white/light background.

```css
@keyframes cup-fill { 0% { transform: scaleY(0); } 100% { transform: scaleY(1); } }
@keyframes steam {
  0%   { transform: translateY(0) scaleX(1); opacity: 0; }
  30%  { opacity: 0.7; }
  100% { transform: translateY(-30px) scaleX(1.4); opacity: 0; }
}
@keyframes fade-in-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

**Supporting motion:** skeleton loading uses a left-to-right shimmer sweep, 1.4s linear infinite. Any element entering the screen fades in with a 10px rise, 0.3s ease-out. Hover/press gives a subtle scale to 1.05 over 200ms. Nothing animates without a functional reason — confirming an action, showing a state change — never decoration for its own sake. Degrade gracefully on weaker tablets rather than stutter.

---

## PART C — The Core Workflow (worked example — build to this exactly)

```text
CUSTOMER ARRIVES
      |
STAFF TAPS "NEW ORDER" -> a new tab opens
      |
STAFF ADDS ITEMS (e.g. Dosa x3, Tea x3)
      |
STAFF TAPS "COOK BILL"
      |
      +-- table not yet selected? -> a popup appears first: "Select a table"
      |      -> staff picks a table -> THEN the Cook Bill actually sends
      |
      +-- table already selected? -> Cook Bill sends immediately
      |
COOK BILL PRINTS: "Dosa x3, Tea x3" -> table flips to Occupied, timer starts
      |
[ later, the SAME customer wants more ]
      |
STAFF SWITCHES TO THAT TABLE'S EXISTING TAB
   (by re-selecting the same table, or tapping its tab directly — both land
    on the SAME session, never a new/duplicate one)
      |
STAFF ADDS MORE ITEMS (e.g. Dosa x2, Tea x5)
      |
STAFF TAPS "COOK BILL" AGAIN
      |
COOK BILL PRINTS ONLY THE NEW ROUND: "Dosa x2, Tea x5"
   (the kitchen never sees the first round repeated)
      |
STAFF'S OWN VIEW shows both rounds, kept separate:
   Round 1: Dosa x3, Tea x3
   Round 2: Dosa x2, Tea x5
      |
TAP "CUSTOMER BILL" (once, at the end)
      |
CUSTOMER BILL SHOWS CONSOLIDATED TOTALS, not round-by-round:
   Dosa   x5   (3+2, one line)
   Tea    x8   (3+5, one line)
      |
PAYMENT -> table releases, timer resets, tab closes
```

**Why this matters, stated plainly:** staff need to see the order broken out by round (so they know what's already been sent vs. what's new), but the customer only ever needs one clean total per item — never three separate lines for the same dish because it was ordered across different rounds. Both views come from the exact same underlying data; they're just displayed differently.

---

## PART D — Order Screen

- **Layout:** horizontal category bar across the top, wide item grid below it, a fixed order panel on the right that never moves while the menu scrolls. The order list inside that panel scrolls on its own — the page itself never scrolls.
- **Search bar** above the category bar — matches item ID, full name, or any substring anywhere inside the name, across every category at once.
- **Adding an item:** one tap, one add — guard against double-firing (a real risk: a tap registering twice doubles quantities and skips order numbers).
- **Item customization:** tapping the item body (not the quick-add `+`) opens quantity + notes (spice level, less sugar, etc.) — stored per line, shown on the Cook Bill.
- **Cook Bill / Customer Bill:** two separate, always-visible buttons at the bottom of the order panel.

---

## PART E — Order Tabs

- Every active order is its own tab, shown in a bar above the Order screen: `[ Table 5 · 12m ] [ Table 8 · 2m ] [ Takeaway #23 ] [ + ]`.
- Switching tabs never loses data — each tab points at its own independent session; switching is just changing which one is displayed.
- Closing a tab that has an unpaid, active order shows a confirmation — *"This table has an unpaid order — close anyway?"* — and confirming must actually close it, not just dismiss the dialog.
- **One table can never have two tabs open for it at once.** Selecting a table that already has an active session always redirects into that existing tab — covered in full in the companion Tables document.

---

## PART F — Bills

**Cook Bill** — kitchen-facing, prints only the current round's new items (Part C), no prices, no totals, just what to cook, plus any per-item notes.

**Customer Bill** — printed once, at the end, consolidated by item across every round (Part C's worked example) — never repeated per round.

**GST — configurable, off by default.** A toggle in Dev Mode. Off: bills show a clean total, nothing added. On: a manually-entered percentage (owner's choice — 1%, 5%, 18%, whatever applies) plus a GST number field activate, and every bill afterward adds a calculated GST line above the total. Flipping the toggle back off returns to no-GST bills immediately; the saved percentage is remembered if it's ever turned back on.

**Bill Setup** (Dev Mode) — café name, logo, address, phone, footer/thank-you text, applied automatically to every bill type.

---

## PART G — Printer Setup (Dev Mode)

- A compact status indicator (top bar) shows **Connected** or **Disconnected** — reflecting the real, actual Bluetooth connection, never a hardcoded or simulated value.
- Tapping it opens a small panel: scan, pair, confirm live status, and a **Print Test** button that sends a genuine test print and reports real success or a retryable error.
- **2–3 default sample thermal templates** ship ready to use: a 2-inch layout, a 3-inch layout, and one alternative style — each previewable with sample data and printable through the exact same engine used for real bills (never a separate hardcoded test-only path).

---

## PART H — Dashboard

Today's Sales, Total Orders, Average Order Value, Dine-in/Takeaway/Delivery split, Cash/UPI/Card split, Best-Selling Items, Peak Hours, Category Sales (using the accent colors from Part B so it reads as genuinely colorful, not monochrome), Customer Analytics, Live Table Status. Customer loyalty tiers (Gold/Silver/Regular by visits or spend) and a Top 5 customers list, both derived from real order history. Charts default to a small, contained size — never covering the whole screen. **No hardcoded or placeholder numbers, anywhere** — every figure is real data or isn't shown.

Explicitly excluded for now: inventory management, Discounts Given / Refunds / Net Profit widgets.

---

## PART I — Dev Mode

- **6-digit PIN: `180704`** — hashed in storage, never shown or transmitted in plain text, independent of any staff login.
- Contains: Bill Setup (F), GST (F), Printer Setup (G), Table Mode toggle (see companion document), Menu Import/Export (JSON, additive-only — adds/updates, never deletes existing items), Full Backup/Restore (menu, tables, customers, full sales history, bill config — one JSON export, previewed before a restore is applied).

---

## PART J — Recommended Tech Direction

Asked directly, here's a clear answer rather than leaving it open:

- **App framework: React Native via Expo, not Flutter.** There's real, working investment in React already — switching frameworks now costs far more than anything Flutter would gain at this stage.
- **Backend: Firebase only — skip a separate Python server.** Firebase (Firestore for the database, Cloud Functions for the small amount of server-side logic that needs enforcing centrally — like "one active session per table," GST calculation, and backup generation) does everything a custom Python backend would, without adding a second piece of infrastructure to deploy and keep running. Introducing a standalone Python server reintroduces exactly the "I don't want to run a server" problem raised earlier in this project — Cloud Functions avoid that entirely.
- **Local storage:** SQLite on-device, so the app keeps working with no internet and nothing is lost on refresh; it syncs up to Firebase once connectivity returns.
- **Build path:** Expo Go for day-to-day development; an EAS development build once real Bluetooth printer testing is needed (Expo Go can't reach native Bluetooth); `eas build --profile production` for the installable APK.

---

## PART K — Confirmed Bugs (fix list)

1. Adding an item can register twice per tap, skipping order numbers (e.g. a 4th order showing as "#8") — guard the add-to-cart action against double-firing.
2. The order list scrolls the whole page instead of scrolling only within its own panel.
3. Closing an unpaid tab shows a confirmation, but confirming doesn't always actually close it.
4. Selecting a table that already has an active order must redirect to the existing tab, never create a second one.
5. Data must survive a page refresh — real local persistence (Part J), not temporary in-memory state.
6. The Customer Bill must consolidate repeated items into one line (Part C) — never list the same dish multiple times because it was ordered across different rounds.
7. Printer status must reflect genuine hardware connection — never a fake "Connected" value.

---

## PART L — Build Priority

1. Real, working data persistence — nothing else can be trusted until data survives a refresh.
2. One-active-session-per-table + the tab bugs (Part E, K.3–K.4) — the core data-integrity fixes.
3. Order screen's double-add and scroll bugs, Customer Bill consolidation (Part C, K.1–K.2, K.6).
4. GST (Part F) and Printer Setup (Part G) — configurable billing and real hardware.
5. Dev Mode (Part I) and Dashboard (Part H).
6. Everything in the companion Tables & Kitchen Portal document.
