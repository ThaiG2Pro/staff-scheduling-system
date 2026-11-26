# Staff Scheduling System

This web application helps store managers turn hourly transaction history into demand-aware, fair weekly schedules with live coverage feedback.

- **Live Demo:** https://scheduler.thais.software
- **Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Vitest, Playwright

---

## 1. Quick Start

> **Prerequisites:** You need Node.js (LTS) and `pnpm` (via `mise` or standalone) to run the project locally.

```bash
pnpm install
pnpm run dev
```

You can open http://localhost:5173 in your browser to start planning immediately. The app saves all data locally in `localStorage`, includes a built-in demo schedule, and imports `report_Transaction_20260807_20260813.csv` directly.

### Verification Commands

```bash
pnpm run typecheck                        # Verify TypeScript types (0 errors)
pnpm test                                 # Run unit & UI integration tests (8 files, 53 tests)
pnpm run test:coverage                    # Check test coverage (~90.6% stmts / ~90.1% branches)
pnpm run build && pnpm run bench:browser  # Measure browser scheduling speed (100 runs/dataset)
```

---

## 2. Key Product Decisions & Rules

- **Demand-to-Staffing Ratio (`N = 15` default, configurable `1–500`):** The app defaults to 1 staff member per 15 transactions per hour (roughly 1 customer every 4 minutes per person, which fits retail and food-service counters) and always requires at least 1 staff member during open hours. On the sample dataset (peak `64 txns/hr`, typical `25–35 txns/hr`), this setting recommends 5 staff during peak hours and 2–3 staff during regular hours, and managers can adjust `N` live at any time.
- **One Shift per Staff per Day:** The scheduler assigns at most one shift per staff member on any given day. This rule prevents split-shift fatigue and keeps the weekly roster easy to scan.
- **Shift Active Days & Staff Availability:** Managers can choose which weekdays each shift runs and mark each staff member's unavailable days. When a manager removes a weekday from a shift, the app previews affected assignments and clears them only after confirmation.
- **Hard Blocks vs. Soft Warnings:** The app blocks assignments on inactive shift days because those shifts do not operate on that day. In contrast, the app allows managers to override weekly hour caps or staff days off during emergencies, and it immediately flags those assignments with clear warning badges so nothing slips by unnoticed.
- **Draft, Not Final (with Pinning & Undo):** Auto-schedule produces an editable starting draft rather than a locked plan. Managers can pin key assignments so future auto-schedule runs keep them intact, adjust any slot inline, or press `Ctrl+Z` to undo changes safely.
- **Flexible CSV Import & Safe Local Storage:** The CSV importer handles messy real-world exports—including title banner rows and different weekday orders (the sample file runs `Fri–Thu` and normalizes automatically to `Mon–Sun`)—and it reports exact row and column errors for invalid files. The app persists schedules in `localStorage` for instant zero-backend setup, and it validates stored data with a recovery backup if a browser payload becomes corrupted.

---

## 3. UX & Workflow Highlights (§2.7)

- **Weekly Roster (Shift × Day Matrix):** The main grid displays shifts as rows and weekdays (`Mon–Sun`) as columns so a non-technical manager sees shift coverage at a glance. Inactive shift cells appear disabled, assignments on staff days off show clear warning flags, and clicking any slot opens a **Quick-Assign** popover that shows each employee's remaining hours and conflicts.
- **Sticky Staff Panel & KPI Lenses:** The side panel displays weekly hour utilization bars and day-off summaries for every team member. Managers can filter the team with one-click **KPI Lenses** (`All`, `Overworked`, `Under-utilized`, `Near Cap`) to spot staffing issues immediately.
- **Schedule Health Bar:** The top workspace bar tracks four live health signals—`Staffing Gaps`, `Hour Limit Warnings`, `Demand Coverage`, and `Fairness`—so managers spot problems without scanning every table cell.
- **Dual Hourly Summary (7×16):** Managers can switch between **Metrics View** (`Transactions`, `Staff Hours`, and `Txns / Staff Hour` with `–` for zero-staff hours, plus both weekly *overall* and *average* per-cell ratios) and **Coverage View** (required vs. scheduled headcount with a 3-tier red heatmap for shortages and badges for overstaffing).
- **Live Feedback:** Every manual edit immediately recalculates staff hour totals, warning badges, the Health Bar, and both Summary views.

---

## 4. Research Note: Existing Scheduling Tools (§2.8)

Before designing this app, I evaluated **Deputy** and **Legion** from a store manager's perspective by walking through four real weekly tasks instead of comparing feature lists:

### Manager Walkthrough (What Helped vs. What Got in the Way)
- **Build next week's roster:** Legion's demand-driven scheduling removes spreadsheet guesswork, but its enterprise setup flows (roles, pay rates, labor-law rules, multi-location settings) create heavy friction for a single store.
- **Add cover for a busy Saturday:** Legion's demand-vs-scheduled overlay highlights peak shortages immediately, whereas plain shift lists force managers to add up overlapping shifts in their heads.
- **Replace someone who calls in sick:** Deputy's inline click-to-edit roster makes quick swaps effortless when remaining hours stay visible, while modal-heavy forms slow down urgent morning changes.
- **Check nobody is over their hours:** Deputy's weekly hour totals catch overtime early, though long employee lists still require extra scrolling to spot who is near or over their limit.

### What I Adopted (and Why)
- **Visual coverage triage (from Legion):** I built **Coverage View** with a 3-tier shortage heatmap so managers spot busy Saturday shortfalls in seconds.
- **Fast inline editing with live guidance (from Deputy):** I added a **Quick-Assign** popover that shows remaining hours and same-day conflicts so managers replace a sick employee in 1–2 clicks.
- **Always-visible hour caps:** I kept weekly utilization bars, warning banners, and one-click **KPI Lenses** visible in the sticky **Staff Panel** at all times.

### What I Chose to Do Differently (and Why)
- **Shift × Day matrix instead of Deputy's Staff × Day default:** For a small store, managers first ask *"Is Saturday morning covered?"* rather than *"What is Alex's personal calendar?"*. Putting shifts on rows answers coverage immediately, while the adjacent Staff Panel still keeps the per-person view one glance away.
- **Lean shift setup & unified tab bar:** Instead of burying shifts behind pay-rate forms or hiding coverage charts on a separate analytics page, I kept shifts lean (`start – end` plus optional active weekdays) and placed **Metrics View | Coverage View** right in the main tab bar for one-click switching.

### Dogfooding on This App
When I ran the same four tasks in my own build, I found and fixed two friction points: (1) I moved the `Metrics View | Coverage View` toggle into the main tab bar to free vertical space for the 16-hour table, and (2) I upgraded flat shortage highlights into a 3-tier red heatmap so severe peak gaps stand out clearly from minor 1-person shortages.

---

## 5. Auto-Schedule Logic & Performance

### How We Define Fairness
The scheduler measures fairness with **Jain's Fairness Index** on each eligible employee's **weekly utilization ratio** (`assignedHours / maxWeeklyHours`), rather than raw hours. Using utilization ratio ensures that a part-time worker (20h cap) and a full-time worker (40h cap) receive proportionally fair shares of work, while employees marked unavailable on all 7 days are excluded so they do not skew team fairness.

### Two-Stage Scheduling Logic
Why two stages? Separating coverage from fairness ensures that the scheduler always covers busy store hours first and improves fairness second, without ever trading away store coverage for a small fairness gain. Every run is fully deterministic: identical inputs always produce the exact same schedule.

1. **Stage 1 — Cover the Store First:**
   - The solver converts hourly transactions into required staff counts (`ceil(txns / N)`, minimum `1` when open).
   - It fills zero-staff hours first, then adds shifts to reduce remaining hourly shortages across active shift days.
   - When picking a staff member for a shift, it prioritizes **staff with the fewest available days first** (keeping flexible staff free for scarce or busy days), then prefers staff whose remaining weekly hours fit the shift tightly, while strictly respecting hour caps, 1 shift/day, unavailable days, and pinned assignments.
2. **Stage 2 — Rebalance for Fairness (Zero Coverage Loss):**
   - The solver keeps the exact hourly coverage achieved in Stage 1 untouched.
   - It repeatedly tests moving a shift to another available person (`REASSIGN`) or swapping two shifts of different lengths (`SWAP`) whenever a move improves team fairness, and it stops once no further improvement exists.
3. **Graceful Trade-offs:**
   - When store demand exceeds available staff hours, Stage 1 covers the busiest hours first and surfaces every remaining shortage clearly in **Coverage View** and the **Health Bar**. When staff capacity exceeds demand, the solver leaves extra capacity unused instead of overstaffing quiet hours.

### Browser Speed (Instant Manager Experience)
The scheduler runs directly in the browser with no backend server, and it finishes well under `50 ms` so clicking **Auto-schedule** feels instant with zero loading spinner (measured across 100 runs in Chromium):

| Store Size | Typical Time (Median) | Slowest Run (Max) |
|---|---|---|
| **Standard Store** (12 staff, 4 shifts) | `0.3 ms` | `0.7 ms` |
| **Large Store** (30 staff, 6 shifts) | `1.9 ms` | `2.4 ms` |
| **Stress Test** (50 staff, 6 shifts) | `23.0 ms` | `26.9 ms` |

---

## 6. Project Structure

I separated the pure scheduling and calculation logic (`src/domain/`) from React UI components so business rules remain easy to test and ready to move to a backend service later if needed:

- `src/domain/` — Pure TypeScript logic for CSV import, shift/staff validation, summary metrics, and the two-stage auto-scheduler.
- `src/state/` — Application store connecting user actions and undo snapshots to the domain logic.
- `src/persistence/` — `localStorage` adapter with schema validation and corrupted-data recovery.
- `src/ui/` — Interactive workspace screens, roster grid, staff panel, health bar, and summary views.

---

## 7. AI Usage Note (§1)

- **What I delegated to AI:** I used AI to scaffold TypeScript domain types, handle CSV parsing edge cases, set up Vitest and Playwright benchmark harnesses, and optimize internal Stage 2 loops (such as typed arrays and bitmasks) so larger stores run smoothly in the browser.
- **What I verified myself:** I verified all summary arithmetic (especially *overall* vs. *average* `Txns / Staff Hour` and division-by-zero handling), hard scheduling rules (`maxWeeklyHours`, 1 shift/day, shift active days, staff unavailable days, and pin preservation), and browser speed through 53 passing automated tests (`~90.6%` coverage) and 100-run Chromium benchmarks.
- **Where I overrode AI suggestions:**
  - I rejected a nested sub-header for `Metrics View | Coverage View` and moved the switch into the main tab bar to save vertical space for the 16-hour grid.
  - I replaced flat red shortage highlights with a 3-tier severity heatmap so managers triage peak-hour deficits faster.
  - I replaced brittle automated E2E walkthrough scripts with targeted unit/integration tests and hands-on manual manager walkthroughs (`M-01..M-10`) to validate real interaction feel.
