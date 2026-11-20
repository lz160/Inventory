# IMS Acceptance Verification Report

> **Verified By**: Automated Unit Tests (`tests/unit/*.test.ts`) + Full E2E Express Integration Tests (`tests/integration/ims.e2e.test.ts` on SQLite Sandbox + Fail-Fast MSSQL Check)
> **Command**: `npx tsx --test tests/unit/*.test.ts tests/integration/*.test.ts` — **20/20 Passed (0 Failed)**

---

## M1 Inventory (`AC-INV-01` .. `AC-INV-14`)

| ID | Criterion | Status | Verification Evidence |
|---|---|---|---|
| `AC-INV-01` | Stable pagination with no duplicates/omissions & exact `total` | PASS | `ims.e2e.test.ts`: 12 seeded SKUs paged `pageSize=5` across pages 1–3 yielded 12 distinct barcodes matching `total=12`; `page=99999` returned `[]` + `total=12`. |
| `AC-INV-02` | Exact `barcode` vs fuzzy `q` & `TRIM(Barcode)` matching | PASS | `ims.e2e.test.ts`: `q=甲商品` matched 1 row; `q=1000000000006` and `/products/1000000000006` both hit `' 1000000000006 '`. |
| `AC-INV-03` | Mutually exclusive tri-state `in` / `low` / `out` | PASS | `inventory.test.ts` exhaustive matrix across `[-1, 0, 3, 5, 6, null]` × `[0, 5]` + `ims.e2e.test.ts` DB query confirmed zero overlap. |
| `AC-INV-04` | Duplicate barcode create returns `409 / 40901` without overwriting | PASS | `ims.e2e.test.ts`: `POST /api/g1/products` on `1000000000001` returned HTTP 409 `code=40901`; `Nazov` stayed `甲商品 正常`. |
| `AC-INV-05` | Minimal create fills 32-column defaults (`DPHtype=1`, `NotNewForCloud=1`) | PASS | `inventory.test.ts` + `ims.e2e.test.ts`: `POST 9999999999999` persisted `Cena=0`, `Surplus=0`, `DPHtype=1`, `NotNewForCloud=1`, `InstallDate`. |
| `AC-INV-06` | Edit whitelist rejects `WarningAt` / `Barcode` with `422 / 42201` | PASS | `inventory.test.ts` + `ims.e2e.test.ts`: `PATCH { WarningAt: 99 }` returned `422 / 42201`; DB `WarningAt` unchanged. |
| `AC-INV-07` | Price change writes `PriceHistory` (`Source='ims'`) | PASS | `ims.e2e.test.ts`: `PATCH { Cena: 20 }` updated `g1` and inserted `PriceHistory` row. |
| `AC-INV-08` | Unchanged price writes zero `PriceHistory` entries | PASS | `ims.e2e.test.ts`: second `PATCH { Cena: 20 }` kept `PriceHistory` count unchanged (`2`). |
| `AC-INV-09` | Batch price rejects empty filter/barcodes (`422`) & caps >500 | PASS | `inventory.test.ts` (600 -> 500 truncation & empty rejection) + `ims.e2e.test.ts` HTTP 422 assertion. |
| `AC-INV-10` | Batch price filtered by supplier updates only target rows | PASS | `ims.e2e.test.ts`: `filter: { supplier: 'FashionSK' }` returned `affected=2`, leaving other suppliers untouched. |
| `AC-INV-11` | Low-stock alert returns `WarningAt>0 AND Surplus<=WarningAt` with `Gap` | PASS | `ims.e2e.test.ts`: barcode `1000000000002` (`Surplus=5, WarningAt=10`) returned with `Gap=5`. |
| `AC-INV-12` | Distinct sorted suppliers dropdown | PASS | `ims.e2e.test.ts`: `/api/g1/suppliers` returned sorted unique supplier names. |
| `AC-INV-13` | Capability RBAC returns `401 / 40001` & `403 / 40003` | PASS | `ims.e2e.test.ts`: `anonymous` -> 401/40001; `viewer` `PATCH` -> 403/40003. |
| `AC-INV-14` | Product delete requires frontend second modal & deletes cleanly | PASS | `InventoryModule.tsx` displays product-named modal; `DELETE` returned `{ deleted: true }`. |

---

## M3 Stocktake (`AC-STK-01` .. `AC-STK-12`)

| ID | Criterion | Status | Verification Evidence |
|---|---|---|---|
| `AC-STK-01` | Omitted name generates `盘点-YYYY-MM-DD` (Bratislava date) | PASS | `stocktake.test.ts` (DST midnight test) + `ims.e2e.test.ts`. |
| `AC-STK-02` | Server computes `Variance = CountedQty - SystemQty` | PASS | `stocktake.test.ts` (`7-10=-3, 10-10=0, 12-10=+2`) + `ims.e2e.test.ts` (`7-50=-43`). |
| `AC-STK-03` | Rejects negative `countedQty` (`422`) with zero side effects | PASS | `stocktake.test.ts` + `ims.e2e.test.ts`. |
| `AC-STK-04` | Immediate `g1.Surplus` write-back upon line entry | PASS | `ims.e2e.test.ts`: reading `/api/g1/products/1000000000001` immediately after line post showed `Surplus=7`. |
| `AC-STK-05` | Optional `warningAt` written to `g1.WarningAt`; omitted preserves existing value | PASS | `ims.e2e.test.ts`: `warningAt: 5` updated `g1.WarningAt=5`; omitted in second scan kept `WarningAt=5`. |
| `AC-STK-06` | Re-scanning same barcode overwrites single `StocktakeLine` row | PASS | `ims.e2e.test.ts`: re-scan `countedQty=9` kept `lines.length === 1` with `CountedQty=9, SystemQty=7, Variance=2`. |
| `AC-STK-07` | Submit sets `Status='submitted'` & `SyncedToG1`, locking new lines (`422`) | PASS | `ims.e2e.test.ts`: submit succeeded; subsequent `POST /lines` returned HTTP 422. |
| `AC-STK-08` | Empty stocktake submit rejected (`422`) | PASS | `ims.e2e.test.ts`: empty submit returned 422. |
| `AC-STK-09` | Unknown barcode line rejected (`404`) with zero side effects | PASS | `ims.e2e.test.ts`: `0000000000000` returned 404. |
| `AC-STK-10` | Transactional delete removes lines & header without orphans | PASS | `ims.e2e.test.ts`: deleted submitted stocktake, `StocktakeLine` count = 0. |
| `AC-STK-11` | Detail endpoint lines satisfy `Variance == CountedQty - SystemQty` | PASS | `ims.e2e.test.ts` detail response assertions. |
| `AC-STK-12` | `viewer` role denied on all M3 endpoints (`403 / 40003`) | PASS | `ims.e2e.test.ts`: `viewer` `GET /api/stocktakes` returned 403/40003. |

---

## M2 Sales Analytics (`AC-SAL-01` .. `AC-SAL-14`)

| ID | Criterion | Status | Verification Evidence |
|---|---|---|---|
| `AC-SAL-01` | `Delta < 0` only; inbound `Delta > 0` excluded (`15 / 61.50`) | PASS | `ims.e2e.test.ts`: `/api/sales/summary` asserted exact `totalQty=15, totalRevenue=61.5`. |
| `AC-SAL-02` | Excludes `AppName IN ('Tedious', 'node-mssql')` | PASS | `ims.e2e.test.ts`: seeded `Tedious` row excluded from summary/top. |
| `AC-SAL-03` | Inclusive `[00:00:00, 23:59:59]` Bratislava day boundaries | PASS | `sales.test.ts` + `ims.e2e.test.ts`: `2026-07-01T21:59:59Z` (23:59:59 CEST) included in `07-01`, `22:00:00Z` excluded. |
| `AC-SAL-04` | ISO-8601 week grouping (`YYYY-Www`) including cross-year weeks | PASS | `sales.test.ts` (`2024-12-30 -> 2025-W01`, `2026-12-28..2027-01-03 -> 2026-W53`) + `ims.e2e.test.ts`. |
| `AC-SAL-05` | Top sorted desc by `SoldQty` & `limit=1000` clamped to `200` | PASS | `sales.test.ts` + `ims.e2e.test.ts`: top row `1000000000002 (SoldQty=10)`. |
| `AC-SAL-06` | Slow-moving lists zero-sales `Surplus > 0` items first | PASS | `ims.e2e.test.ts`: first row was `1000000000012 (SoldQty=0, Surplus=40)`. |
| `AC-SAL-07` | Restock formulas `DailyRate`, `DaysLeft`, `SuggestedQty` | PASS | `sales.test.ts`: `Surplus=10, days=30, SoldQty=60 -> DailyRate=2, DaysLeft=5, SuggestedQty=50`. |
| `AC-SAL-08` | Zero-sales restock returns `DaysLeft=null` (`∞`) sorted last | PASS | `sales.test.ts` + `ims.e2e.test.ts`. |
| `AC-SAL-09` | VAT 23% formulas (`Cena=123, Cena2=80 -> 43 / 100 / 20 / 20.0%`) | PASS | `inventory.test.ts` exact assertion. |
| `AC-SAL-10` | `Cena=0` netMarginRate returns `null` (renders `—`, no `Infinity`) | PASS | `inventory.test.ts` + `SalesAnalyticsModule.tsx`. |
| `AC-SAL-11` | Category `revenueShare` sums to `1` and matches `/summary` | PASS | `ims.e2e.test.ts`: `Math.abs(sumShare - 1) < 0.001` & `total.revenue === 61.5`. |
| `AC-SAL-12` | `__uncat__` fixed on final row regardless of revenue size | PASS | `ims.e2e.test.ts` asserted `rows[rows.length - 1].code === '__uncat__'`. |
| `AC-SAL-13` | Read paths never write `product_meta`; only `POST /auto-categorize` writes | PASS | `ims.e2e.test.ts`: verified `metaStore.size === 0` after `GET /uncategorized`. |
| `AC-SAL-14` | Empty/future date ranges return `0` / `[]` cleanly | PASS | `ims.e2e.test.ts`: `2099-01-01..2099-01-31` returned `totalQty=0, totalRevenue=0`. |
