# IMS (M1 / M3 / M2) API Specification & Contracts

## 1. Authentication, Capability Authorization & Uniform Response Envelope

### 1.1 Simulated Role Header (`x-ims-role` / `x-ims-user`)
Single-store mode (`Q5`). Requests supply `x-ims-role` and optional `x-ims-user` headers:
- `admin`: `inventory.view`, `inventory.edit`, `product.create`, `sales.view`, `alert.view`
- `manager`: `inventory.view`, `inventory.edit`, `sales.view`, `alert.view`
- `stock_clerk`: `inventory.view`, `inventory.edit`, `alert.view`
- `viewer`: `inventory.view`, `sales.view`, `alert.view`
- `sales_only`: `sales.view`
- `anonymous`: unauthenticated (`401 / 40001`)

### 1.2 Response Envelope & Error Codes (§3.3)
- Success: `{ "code": 0, "data": <payload>, "message": "" }`
- Failure: `{ "code": <error_code>, "message": "<reason>" }`

| HTTP | Business Code | Semantics | Trigger Conditions |
|---|---|---|---|
| 401 | `40001` | Unauthorized | `x-ims-role: anonymous` or missing session |
| 403 | `40003` | Forbidden | Role lacks required endpoint capability |
| 404 | `40404` | Not Found | Missing barcode in `g1` or missing stocktake ID |
| 409 | `40901` | Conflict | Duplicate barcode during `POST /api/g1/products` |
| 422 | `42201` | Validation Error | Empty/overlong barcode (>13), negative stocktake `countedQty`, invalid `YYYY-MM-DD`, empty batch-price filter, PATCH containing only non-editable fields (`WarningAt`, `Barcode`) |
| 500 | `50000` | Server Error | Database unreachable (fail-fast, never silent fallback), Step-2 `g1` write-back failure, or query timeout |
| 501 | `50101` | Not Implemented | Unimplemented adapter placeholder |

---

## 2. Explicit Transaction, Consistency & Boundary Policies

1. **Stocktake Two-Step Cross-Database Write (`§6.2` / `§7.4`)**:
   - Step 1 upserts `SaleData.dbo.StocktakeLine` matching `(StocktakeId, TRIM(Barcode))`.
   - Step 2 immediately runs `UPDATE SKLAD.dbo.g1 SET Surplus = @countedQty [, WarningAt = @warningAt] WHERE TRIM(Barcode) = @bc`.
   - Distributed cross-DB transactions are prohibited (`§7.4`). If Step 2 fails, the API returns HTTP `500 / 50000` with explicit instructions so the operator can re-scan the barcode (idempotent upsert) without silent data loss (`B-30`).
2. **Batch Price Update (`R-INV-5` / `§7.4` / `B-28`)**:
   - **Partial-Success Per-Row Semantics**: Matching rows (or checked `barcodes`, truncated cleanly at **500 barcodes** per request) are updated row-by-row with individual non-blocking `PriceHistory` records; returns `{ affected }`.
   - Full-table updates are rejected with `422 / 42201` ("禁止全表改价").
3. **No Optimistic Locking (`B-31`)**:
   - Concurrent `PATCH /api/g1/products/:barcode` updates follow last-write-wins semantics; each request writes `PriceHistory` relative to its own pre-update snapshot.
4. **ASCII Case Sensitivity (`B-04`)**:
   - Product barcode comparisons follow the underlying database collation (`SQL_Latin1_General_CP1_CI_AS` in SQL Server = case-insensitive; `BINARY` in SQLite sandbox) after server-side `TRIM()`.
5. **Pagination, Limit & Date Boundaries (`B-11`, `B-15..B-17`, `B-35`)**:
   - `page < 1` clamps to `1`; out-of-range `page` returns `rows: []` with accurate `total`.
   - `pageSize` & `limit` silently clamp to `[1, 200]`.
   - Invalid calendar dates (`2026-13-01`, `2026/01/01`) fail with `422 / 42201`. Reversed date ranges (`from > to`) return empty results cleanly (`totalQty: 0`, `rows: []`). Maximum query span is 1100 days (~3 years).
6. **Delete Confirmation (`AC-INV-14`, `B-25`)**:
   - Both product deletion (`DELETE /api/g1/products/:barcode`) and submitted stocktake deletion (`DELETE /api/stocktakes/:id`) require explicit second-step modal confirmation in the UI naming the target record; backend logs audit details cleanly.

---

## 3. M1 Inventory Endpoints (`/api/g1/*`)

- `GET /api/g1/products` (`inventory.view`) — Filters: `barcode, kod, q, supplier, stock (in|low|out), page, pageSize, sortBy, sortDir`. Stable secondary sort `, Barcode ASC`. Returns `{ rows, total, page, pageSize }`.
- `GET /api/g1/products/:barcode` (`inventory.view`) — Trims barcode (`TRIM(Barcode) = @bc`).
  - Example 200: `{ "code": 0, "data": { "Barcode": "1000000000001", "Nazov": "甲商品 正常", "Surplus": 50, ... }, "message": "" }`
  - Example 404: `{ "code": 40404, "message": "条码 0000 的商品不存在" }`
  - Example 401: `{ "code": 40001, "message": "未登录或登录令牌已过期，请先选择操作角色" }`
- `POST /api/g1/products` (`product.create`) — Creates 32-column `g1` row, rejects duplicates with `409 / 40901`, records 2 non-blocking `PriceHistory` baselines. Allows negative `Surplus`.
- `PATCH /api/g1/products/:barcode` (`inventory.edit`) — Enforces 29-field editable whitelist (`WarningAt`, `Barcode`, `InstallDate` rejected with `422 / 42201` if no other fields present).
- `PATCH /api/g1/products/:barcode/category` (`inventory.edit`) — Stores local category metadata in SQLite `product_meta`.
- `DELETE /api/g1/products/:barcode` (`inventory.edit`) — Returns `{ deleted: true }` or `404 / 40404`.
- `POST /api/g1/batch-price` (`inventory.edit`) — Requires `patch.Cena` and/or `patch.Cena2`, plus `barcodes[]` or non-empty `filter`. Returns `{ affected }`.
- `GET /api/g1/suppliers` (`inventory.view`) — Distinct trimmed non-empty suppliers sorted ascending (max 300).
- `GET /api/g1/low-stock` (`alert.view`) — `WarningAt > 0 AND Surplus <= WarningAt ORDER BY (WarningAt - Surplus) DESC, Barcode ASC` with computed `Gap`.
- `GET /api/g1/export` (`inventory.view`) — Streams `.xlsx` inventory sheet.

---

## 4. M3 Stocktake Endpoints (`/api/stocktakes/*`)

- `POST /api/stocktakes` (`inventory.edit`) — Empty `name` defaults to `盘点-YYYY-MM-DD` (`Europe/Bratislava`), max 200 chars. Returns header + `lines: []`.
- `GET /api/stocktakes` (`inventory.edit`) — Lists sessions with `LineCount` & `DiffCount`.
- `GET /api/stocktakes/:id` (`inventory.edit`) — Returns `{ stocktake, lines }`.
- `POST /api/stocktakes/:id/lines` (`inventory.edit`) — Validates `open` state, `countedQty >= 0`, `warningAt >= 0`, `g1` existence (`404 / 40404`), upserts line, immediately writes `g1.Surplus` (and optional `WarningAt`).
  - Example 200: `{ "code": 0, "data": { "Barcode": "1000000000001", "SystemQty": 50, "CountedQty": 7, "Variance": -43 }, "message": "" }`
  - Example 422 (negative qty): `{ "code": 42201, "message": "实盘数量 (countedQty) 必须为非负有效数字" }`
  - Example 403 (`viewer`): `{ "code": 40003, "message": "当前角色缺乏所需权限: inventory.edit" }`
- `POST /api/stocktakes/:id/submit` (`inventory.edit`) — Requires `Status = 'open'` and `lines.length > 0`. Locks session (`submitted`, `SyncedToG1 = now`).
- `DELETE /api/stocktakes/:id` (`inventory.edit`) — Transactionally removes lines + header.
- `GET /api/stocktakes/:id/export` (`inventory.edit`) — Streams `.xlsx` stocktake variance workbook.

---

## 5. M2 Sales Analytics Endpoints (`/api/sales/*`, all require `sales.view`)

Filter baseline: `d.Delta < 0 AND l.AppName NOT IN ('Tedious', 'node-mssql')`, with `SoldQty = -d.Delta` and `Revenue = -d.Delta * d.Cena`. Timestamps grouped in `Europe/Bratislava`.

- `GET /api/sales/summary` — `{ totalQty, totalRevenue, zeroPriceQty, zeroPricePct, from, to }`
- `GET /api/sales/timeseries?granularity=day|week|month` — ISO 8601 week (`YYYY-Www`).
- `GET /api/sales/top?limit=20` — Top sold SKUs enriched from `g1` (`null` for missing `g1` fields).
- `GET /api/sales/slow?limit=20` — All `Surplus > 0` products left-joined with sales (`SoldQty=0` first).
- `GET /api/sales/margin?limit=50` — Sales rows with `Cena` & `Cena2` for VAT 23% margin display.
- `GET /api/sales/restock?days=30&limit=50` — `DailyRate = SoldQty/days`, `DaysLeft = Surplus/DailyRate` (`null` -> `∞` sorted last), `SuggestedQty = max(0, ceil(DailyRate * 30 - Surplus))`.
- `GET /api/sales/by-category` — Aggregates sales against SQLite `product_meta`; `__uncat__` fixed last.
- `GET /api/sales/uncategorized` — Read-only rule suggestions (`limit <= 500`, zero DB writes).
- `POST /api/sales/auto-categorize` — Single-transaction batch upsert into SQLite `product_meta` (`<= 500`).
- `GET /api/sales/categories` — Bilingual 78-category dictionary.
- `GET /api/sales/export` — Multi-sheet `.xlsx` (`Summary`, `ByCategory`, `TopSales`, `SlowMoving`, `Restock`).

---

## 6. `g1` 32-Field PascalCase Contract Map

All 32 fields are transmitted in exact PascalCase:
`Nazov`, `Cena`, `PovCena`, `Barcode` (PK/New-only), `Mnozstvo`, `Kod`, `Element`, `Class`, `Reserved`, `Surplus`, `VIPnoDiscount`, `barcode2nd`, `conv2ndtobarcode`, `barcodeType`, `DPHtype`, `PurchasePrice`, `Dozen`, `Box`, `menupackage`, `Picture`, `Cena2`, `WarningAt` (M3 Stocktake-only), `MoreSurplus`, `ExpiryDate`, `PurchaseCountry`, `Supplier`, `Companions`, `NotNewForCloud`, `IsUpdateCloud`, `InstallDate` (System-written), `Shelves`, `LastInstallQty`.
