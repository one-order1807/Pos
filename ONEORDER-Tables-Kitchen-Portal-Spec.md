# ONEORDER — Tables, Table Mode & Kitchen Portal Specification

Companion to **ONEORDER-Complete-Feature-Workflow-Spec.md**. This document is the deep dive on the Tables tab, the Table Mode toggle's full effect across the app, and the Kitchen Portal as its own dedicated focus area.

---

## PART A — Tables Tab: Two Views, One Top Switcher

The Tables tab has its own small top-tab-section, letting staff switch between two ways of seeing the same tables:

- **Layout View** — the free-positioned floor plan (arranged to match the café's real seating, Part B below).
- **List View** — a simple sortable list of every table, name and status only, for quickly scanning or searching when the visual floor plan isn't needed.

Both views show the same live data — switching between them is just a display preference, never a different data source.

Each table, in either view, shows its status (Available/Occupied/Cooking/Payment Pending) and elapsed occupied time, ticking accurately and reliably — this timing must actually work correctly, not drift or freeze, since it's the one piece of information staff rely on most when the floor is busy.

---

## PART B — Managing Tables: Labels, Merge, Arrange

Three controls, owner-only:

1. **Labels** — a pen icon appears on every table when this is active; tap one to rename it freely (defaults to "T-1," "T-2"..., but any name works, e.g. "VIP-1").
2. **Merge** — select two or more tables to combine them into one entry (e.g. "T-1M3" for tables 1 through 3 merged), which sorts to the top of the list, behaves as a single table for ordering and billing, and automatically un-merges back into individual tables the instant its Customer Bill is paid.
3. **Arrange** — free drag positioning on a scrollable canvas, no fixed grid — the only place a new table can be added, via a small "+" icon inside this mode, placed directly where it's dropped.

Edits in any of these three modes require an explicit Save/Discard confirmation before they take effect — never a silent autosave on a real floor layout.

---

## PART C — One Table, One Active Order — Enforced

Selecting a table — from the Order screen's table picker, a brand-new tab, or anywhere else — always checks first: **does this table already have an active session?**

- **Yes** → jump straight into that existing session/tab. No second tab is ever created for the same table. This applies the same way whether the intent was adding more items or generating the final bill.
- **No** → a fresh session opens for it.

**Visual indicator:** every table in the picker shows a small colored dot — **green** for free (tapping starts something new), **red** for already active elsewhere (tapping redirects there instead of risking a duplicate/conflicting order). Staff should never have to guess or remember which tables are already in use.

---

## PART D — Table Mode Toggle (Dev Mode) — Full Effect

A single toggle in Dev Mode, for businesses that don't seat customers at tables at all (counter service, a cloud kitchen, pure takeaway/delivery operations).

**Table Mode ON (default):** everything above applies exactly as described — Tables tab visible, Dine-in requires selecting a table, timers run, Merge/Arrange/Labels all active.

**Table Mode OFF:** the following changes take effect app-wide, immediately:
- The **Tables tab disappears entirely** from the main navigation — it's not just hidden behind a setting, it's gone from the tab bar.
- On the **Order screen (home tab)**, the order-type selector no longer offers "Dine-in" as a distinct path requiring a table — orders proceed straight from item selection to Cook Bill/Customer Bill, the same way Takeaway already works, with no table-selection step ever shown.
- Every other part of the app (Menu, Dashboard, Users, Dev Mode, printing, GST) continues to work exactly as before — turning this off only removes the table-specific layer, nothing else.
- Flipping the toggle back ON immediately restores the Tables tab and the Dine-in table-selection step — no data is lost from tables that existed before it was turned off; they're simply hidden while off, not deleted.

---

## PART E — Kitchen Portal (its own dedicated focus)

A **separate tab — Kitchen** — distinct from Table View, giving a clear, focused answer to "what's happening in the kitchen right now."

**Three columns:**
```text
KITCHEN

PENDING              COOKING              READY (most recent first)
[ Table 8            [ Table 5            [ Table 3
  1x Cold Coffee        2x Masala Dosa       1x Cappuccino
  Sent 9m ago            1x Cappuccino        Done 2m ago
  Start Cooking ]       Mark Ready ]

[ Table 12
  3x Filter Coffee
  Sent 2m ago
  Start Cooking ]
```

- **Pending** — every newly sent Cook Bill lands here first, oldest at the top by default.
- **Cooking** — moved here once the kitchen actually starts it.
- **Ready** — completed items, most recent at the top, so it's easy to confirm what just finished.

**Setting priority — the main feature of this tab:** within Pending, staff can drag a ticket up or down to change cook order, overriding strict first-in-first-out. This is for exactly the real situation where ten orders are waiting but one table is in a hurry while another is perfectly happy to wait — drag the urgent one above the rest, and the kitchen works from that order instead of guessing.

Each ticket shows the table/order label, items with notes, and time since sent, with a visual escalation (fresh → getting old → overdue) so nothing silently sits forgotten.

---

## PART F — Build Priority for This Document

1. **Part C** (one active session per table, enforced + the visual indicator) — the core data-integrity guarantee everything else depends on.
2. **Part D** (Table Mode toggle and its full app-wide effect) — a clean on/off switch that genuinely changes behavior everywhere it should, nowhere it shouldn't.
3. **Part E** (Kitchen Portal, Pending/Cooking/Ready + drag-to-prioritize).
4. **Part A/B** (the two-view switcher, Labels/Merge/Arrange) — polish once the above is solid and bug-free.
