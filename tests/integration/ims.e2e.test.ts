import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as XLSX from 'xlsx';
import { createTestImsApp } from '../../src/imsApp';
import { MetaStore } from '../../src/core/db/metaStore';
import { SqliteSandbox } from '../../src/core/db/sqliteSandbox';
import { toBratislavaLocalDate } from '../../src/modules/sales/analytics';

let server: http.Server;
let baseUrl = '';
let sandbox: SqliteSandbox;
let metaStore: MetaStore;

async function reqJson(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

describe('IMS M1 / M3 / M2 Full E2E Integration Acceptance Tests', () => {
  before(async () => {
    sandbox = new SqliteSandbox(':memory:', true);
    metaStore = new MetaStore(':memory:');
    const app = createTestImsApp({ dbMode: 'sqlite-seed', sandbox, metaStore });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    metaStore.close();
    sandbox.close();
  });

  it('AC-INV-01..14: M1 Inventory CRUD, pagination stability, whitelist, low-stock, suppliers, XLSX', async () => {
    // AC-INV-01: stable pagination
    const p1 = await reqJson('/api/g1/products?page=1&pageSize=5&sortBy=Barcode&sortDir=asc');
    const p2 = await reqJson('/api/g1/products?page=2&pageSize=5&sortBy=Barcode&sortDir=asc');
    const p3 = await reqJson('/api/g1/products?page=3&pageSize=5&sortBy=Barcode&sortDir=asc');
    assert.equal(p1.status, 200);
    assert.equal(p1.body.data.total, 12);
    const allCodes = [...p1.body.data.rows, ...p2.body.data.rows, ...p3.body.data.rows].map((r: any) => r.Barcode);
    assert.equal(new Set(allCodes).size, 12);

    // B-15: out-of-range page returns empty array + accurate total
    const p999 = await reqJson('/api/g1/products?page=99999&pageSize=20');
    assert.equal(p999.status, 200);
    assert.equal(p999.body.data.rows.length, 0);
    assert.equal(p999.body.data.total, 12);

    // AC-INV-02 & B-01: exact barcode vs fuzzy q vs leading space TRIM
    const fuzzyName = await reqJson('/api/g1/products?q=' + encodeURIComponent('甲商品'));
    assert.equal(fuzzyName.body.data.rows.length, 1);
    assert.equal(fuzzyName.body.data.rows[0].Barcode, '1000000000001');

    const spaceBc = await reqJson('/api/g1/products?q=1000000000006');
    assert.equal(spaceBc.body.data.rows.length, 1);
    assert.equal(spaceBc.body.data.rows[0].Barcode, '1000000000006');

    const exactHit = await reqJson('/api/g1/products/1000000000006');
    assert.equal(exactHit.status, 200);

    // B-18 / B-19: SQL injection resistance
    const sqli = await reqJson('/api/g1/products?q=' + encodeURIComponent("' OR 1=1 --") + '&sortBy=Surplus;DROP%20TABLE%20g1');
    assert.equal(sqli.status, 200);
    assert.equal(sqli.body.data.rows.length, 0);

    // AC-INV-03: mutual exclusion of stock=low and stock=out
    const lowRes = await reqJson('/api/g1/products?stock=low&pageSize=100');
    const outRes = await reqJson('/api/g1/products?stock=out&pageSize=100');
    const lowSet = new Set(lowRes.body.data.rows.map((r: any) => r.Barcode));
    const outSet = new Set(outRes.body.data.rows.map((r: any) => r.Barcode));
    assert.ok(lowSet.has('1000000000002'));
    assert.ok(outSet.has('1000000000003'));
    assert.ok(outSet.has('1000000000004'));
    assert.ok(outSet.has('1000000000010')); // NULL surplus -> out
    for (const code of lowSet) {
      assert.equal(outSet.has(code), false, `Mutual exclusion violated for ${code}`);
    }

    // AC-INV-04: duplicate barcode 409 / 40901
    const dup = await reqJson('/api/g1/products', {
      method: 'POST',
      body: JSON.stringify({ Barcode: '1000000000001', Nazov: 'Overwrite Attempt' }),
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 40901);
    const untouched = await reqJson('/api/g1/products/1000000000001');
    assert.equal(untouched.body.data.Nazov, '甲商品 正常');

    // AC-INV-05: create minimal product defaults
    const created = await reqJson('/api/g1/products', {
      method: 'POST',
      body: JSON.stringify({ Barcode: '9999999999999', Nazov: '新建极简商品' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.code, 0);
    assert.equal(created.body.data.Cena, 0);
    assert.equal(created.body.data.DPHtype, 1);
    assert.equal(created.body.data.NotNewForCloud, 1);

    // AC-INV-06: WarningAt blocked in M1 PATCH
    const blockWarn = await reqJson('/api/g1/products/9999999999999', {
      method: 'PATCH',
      body: JSON.stringify({ WarningAt: 99 }),
    });
    assert.equal(blockWarn.status, 422);
    assert.equal(blockWarn.body.code, 42201);

    // AC-INV-07 & AC-INV-08: PriceHistory written only when price actually changes
    const upd1 = await reqJson('/api/g1/products/9999999999999', {
      method: 'PATCH',
      body: JSON.stringify({ Nazov: '新建改名', Cena: 20 }),
    });
    assert.equal(upd1.status, 200);
    assert.equal(upd1.body.data.Cena, 20);

    const histCount1 = (
      sandbox.db.prepare(`SELECT COUNT(*) AS cnt FROM PriceHistory WHERE Barcode='9999999999999' AND Field='Cena'`).get() as any
    ).cnt;
    assert.equal(histCount1, 2); // 1 baseline + 1 change

    await reqJson('/api/g1/products/9999999999999', {
      method: 'PATCH',
      body: JSON.stringify({ Cena: 20 }),
    });
    const histCount2 = (
      sandbox.db.prepare(`SELECT COUNT(*) AS cnt FROM PriceHistory WHERE Barcode='9999999999999' AND Field='Cena'`).get() as any
    ).cnt;
    assert.equal(histCount2, 2); // unchanged

    // AC-INV-11: low-stock Gap computation
    const alertRes = await reqJson('/api/g1/low-stock');
    assert.equal(alertRes.status, 200);
    const p2Row = alertRes.body.data.rows.find((r: any) => r.Barcode === '1000000000002');
    assert.ok(p2Row);
    assert.equal(p2Row.Gap, 5); // WarningAt 10 - Surplus 5

    // AC-INV-12: distinct sorted suppliers
    const supRes = await reqJson('/api/g1/suppliers');
    assert.equal(supRes.status, 200);
    assert.deepEqual(supRes.body.data, [...supRes.body.data].sort());

    // Export XLSX sanity
    const xlsxRes = await fetch(`${baseUrl}/api/g1/export`);
    assert.equal(xlsxRes.status, 200);
    const buf = Buffer.from(await xlsxRes.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    assert.ok(wb.SheetNames.includes('Inventory'));

    // Import template XLSX download & bulk upsert import
    const tplRes = await fetch(`${baseUrl}/api/g1/import-template`);
    assert.equal(tplRes.status, 200);
    const tplWb = XLSX.read(Buffer.from(await tplRes.arrayBuffer()), { type: 'buffer' });
    assert.ok(tplWb.SheetNames.includes('Inventory'));
    assert.ok(tplWb.SheetNames.includes('FieldGuide'));

    const importRes = await reqJson('/api/g1/import', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'upsert',
        items: [
          {
            rowNumber: 2,
            Barcode: '9999999999999',
            Surplus: 42,
            Cena: 11.5,
            category: 'food_snack',
          },
          {
            rowNumber: 3,
            Barcode: '8888888888888',
            Nazov: 'Batch Imported Item',
            Kod: 'IMP-01',
            Supplier: 'SupA',
            Surplus: 15,
            Cena: 4.92,
            Cena2: 2.5,
            category: 'food_drink',
          },
        ],
      }),
    });
    assert.equal(importRes.status, 200);
    assert.equal(importRes.body.data.created, 1);
    assert.equal(importRes.body.data.updated, 1);
    assert.equal(importRes.body.data.errors.length, 0);

    const impCheck = await reqJson('/api/g1/products/8888888888888');
    assert.equal(impCheck.status, 200);
    assert.equal(impCheck.body.data.Kod, 'IMP-01');
    assert.equal(impCheck.body.data.category, 'food_drink');

    // AC-INV-14: DELETE created items
    await reqJson('/api/g1/products/8888888888888', { method: 'DELETE' });
    const delRes = await reqJson('/api/g1/products/9999999999999', { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.data.deleted, true);
  });

  it('AC-STK-01..12: M3 Stocktake full lifecycle with immediate g1 write-back and transactional delete', async () => {
    // AC-STK-01: create with default name
    const createRes = await reqJson('/api/stocktakes', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(createRes.status, 201);
    const id = createRes.body.data.Id;
    assert.ok(String(createRes.body.data.Name).startsWith('盘点-'));

    // AC-STK-08: empty stocktake cannot submit
    const emptySubmit = await reqJson(`/api/stocktakes/${id}/submit`, { method: 'POST' });
    assert.equal(emptySubmit.status, 422);

    // AC-STK-09: unknown barcode 404
    const unk = await reqJson(`/api/stocktakes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ barcode: '0000000000000', countedQty: 5 }),
    });
    assert.equal(unk.status, 404);

    // AC-STK-03: negative countedQty 422
    const neg = await reqJson(`/api/stocktakes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ barcode: '1000000000001', countedQty: -1 }),
    });
    assert.equal(neg.status, 422);

    // AC-STK-02, 04, 05: immediate g1 Surplus & WarningAt write-back
    const line1 = await reqJson(`/api/stocktakes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ barcode: '1000000000001', countedQty: 7, warningAt: 5 }),
    });
    assert.equal(line1.status, 200);
    assert.equal(line1.body.data.SystemQty, 50);
    assert.equal(line1.body.data.Variance, -43);

    const g1After1 = await reqJson('/api/g1/products/1000000000001');
    assert.equal(g1After1.body.data.Surplus, 7);
    assert.equal(g1After1.body.data.WarningAt, 5);

    // AC-STK-06: re-scan overwrites single line & preserves latest g1 value
    const line2 = await reqJson(`/api/stocktakes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ barcode: '1000000000001', countedQty: 9 }),
    });
    assert.equal(line2.status, 200);
    assert.equal(line2.body.data.SystemQty, 7);
    assert.equal(line2.body.data.Variance, 2);

    const detail = await reqJson(`/api/stocktakes/${id}`);
    assert.equal(detail.body.data.lines.length, 1);
    assert.equal(detail.body.data.lines[0].CountedQty, 9);

    // Export stocktake XLSX
    const expRes = await fetch(`${baseUrl}/api/stocktakes/${id}/export`);
    assert.equal(expRes.status, 200);

    // AC-STK-07: submit locks stocktake
    const subRes = await reqJson(`/api/stocktakes/${id}/submit`, { method: 'POST' });
    assert.equal(subRes.status, 200);
    assert.equal(subRes.body.data.Status, 'submitted');
    assert.ok(subRes.body.data.SyncedToG1);

    const postLock = await reqJson(`/api/stocktakes/${id}/lines`, {
      method: 'POST',
      body: JSON.stringify({ barcode: '1000000000001', countedQty: 10 }),
    });
    assert.equal(postLock.status, 422);

    // AC-STK-10: delete cascades cleanly (allowed even when submitted per Q19)
    const delStk = await reqJson(`/api/stocktakes/${id}`, { method: 'DELETE' });
    assert.equal(delStk.status, 200);
    const orphanLines = (sandbox.db.prepare(`SELECT COUNT(*) AS cnt FROM StocktakeLine WHERE StocktakeId = ?`).get(id) as any).cnt;
    assert.equal(orphanLines, 0);
  });

  it('AC-SAL-01..14: M2 Sales Analytics Delta/AppName filtering, Top/Slow/Restock, Auto-Categorize, Boundary checks', async () => {
    // Default 30-day summary from §10.1 seed data: 2 + 10 + 3 = 15 qty, 24.60 + 0 + 36.90 = 61.50 revenue
    const sum = await reqJson('/api/sales/summary');
    assert.equal(sum.status, 200);
    assert.equal(sum.body.data.totalQty, 15);
    assert.equal(sum.body.data.totalRevenue, 61.5);
    assert.equal(sum.body.data.zeroPriceQty, 10);

    // AC-SAL-04 & AC-SAL-05: timeseries day/week & limit clamp 1000 -> 200
    const tsWeek = await reqJson('/api/sales/timeseries?granularity=week');
    assert.equal(tsWeek.status, 200);
    assert.ok(tsWeek.body.data.rows.every((r: any) => /^\d{4}-W\d{2}$/.test(r.period)));

    const topRes = await reqJson('/api/sales/top?limit=1000');
    assert.equal(topRes.status, 200);
    assert.equal(topRes.body.data.rows[0].Barcode, '1000000000002');
    assert.equal(topRes.body.data.rows[0].SoldQty, 10);
    assert.equal(topRes.body.data.rows[1].Barcode, '1000000000001');
    assert.equal(topRes.body.data.rows[1].SoldQty, 5);

    // AC-SAL-06: slow moving includes zero-sales stocked items first
    const slowRes = await reqJson('/api/sales/slow?limit=20');
    assert.equal(slowRes.status, 200);
    assert.equal(slowRes.body.data.rows[0].SoldQty, 0);
    assert.equal(slowRes.body.data.rows[0].Barcode, '1000000000012'); // Surplus=40 highest unsold

    // AC-SAL-07 & AC-SAL-08: restock metrics & zero-sales sorted at end
    const restockRes = await reqJson('/api/sales/restock?days=30&limit=50');
    assert.equal(restockRes.status, 200);
    const lastRow = restockRes.body.data.rows[restockRes.body.data.rows.length - 1];
    assert.equal(lastRow.DaysLeft, null);

    // AC-SAL-11, 12, 13: uncategorized GET does NOT write product_meta; by-category sums accurately; __uncat__ last
    const uncatBefore = await reqJson('/api/sales/uncategorized');
    assert.equal(uncatBefore.status, 200);
    assert.equal(metaStore.getAllProductMetaMap().size, 0);

    const catBefore = await reqJson('/api/sales/by-category');
    assert.equal(catBefore.status, 200);
    assert.equal(catBefore.body.data.total.revenue, 61.5);
    assert.equal(catBefore.body.data.rows[catBefore.body.data.rows.length - 1].code, '__uncat__');

    // Explicit auto-categorize write
    const autoWrite = await reqJson('/api/sales/auto-categorize', {
      method: 'POST',
      body: JSON.stringify({ items: [{ barcode: '1000000000001', category: 'home_kitchen' }] }),
    });
    assert.equal(autoWrite.status, 200);
    assert.equal(autoWrite.body.data.applied, 1);

    const catAfter = await reqJson('/api/sales/by-category');
    assert.equal(catAfter.body.data.rows[catAfter.body.data.rows.length - 1].code, '__uncat__');
    const sumShare = catAfter.body.data.rows.reduce((s: number, r: any) => s + r.revenueShare, 0);
    assert.ok(Math.abs(sumShare - 1) < 0.001);

    // AC-SAL-14: future empty interval returns 0 / empty without error
    const future = await reqJson('/api/sales/summary?from=2099-01-01&to=2099-01-31');
    assert.equal(future.status, 200);
    assert.equal(future.body.data.totalQty, 0);
    assert.equal(future.body.data.totalRevenue, 0);

    // B-11: reversed dates return empty cleanly
    const reversed = await reqJson('/api/sales/top?from=2026-10-10&to=2026-10-01');
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.data.rows.length, 0);

    // B-12: invalid date returns 422
    const badDate = await reqJson('/api/sales/summary?from=2026-13-01&to=2026-13-05');
    assert.equal(badDate.status, 422);

    // B-13: test exact local Bratislava 23:59:59 inclusion vs next-day 00:00:00 exclusion
    const ts2359 = '2026-07-01T21:59:59.000Z'; // 2026-07-01 23:59:59 CEST
    const ts0000 = '2026-07-01T22:00:00.000Z'; // 2026-07-02 00:00:00 CEST
    assert.equal(toBratislavaLocalDate(ts2359), '2026-07-01');
    assert.equal(toBratislavaLocalDate(ts0000), '2026-07-02');
    const l1 = Number(sandbox.db.prepare(`INSERT INTO SalesLog (ChangeTime, AppName) VALUES (?, 'POS')`).run(ts2359).lastInsertRowid);
    sandbox.db.prepare(`INSERT INTO SalesLogDetail (LogId, Barcode, Nazov, Delta, Cena) VALUES (?, '1000000000007', 'Damske', -1, 19.90)`).run(l1);
    const l2 = Number(sandbox.db.prepare(`INSERT INTO SalesLog (ChangeTime, AppName) VALUES (?, 'POS')`).run(ts0000).lastInsertRowid);
    sandbox.db.prepare(`INSERT INTO SalesLogDetail (LogId, Barcode, Nazov, Delta, Cena) VALUES (?, '1000000000007', 'Damske', -2, 19.90)`).run(l2);

    const dstDay = await reqJson('/api/sales/summary?from=2026-07-01&to=2026-07-01');
    assert.equal(dstDay.body.data.totalQty, 1);

    // Sales XLSX export sanity
    const expSales = await fetch(`${baseUrl}/api/sales/export`);
    assert.equal(expSales.status, 200);
  });

  it('B-30: default MSSQL mode fails fast with 500/50000 when MSSQL env vars are unconfigured (no silent fallback)', async () => {
    const isolatedMeta = new MetaStore(':memory:');
    const mssqlApp = createTestImsApp({ dbMode: 'mssql', metaStore: isolatedMeta });
    let srv!: http.Server;
    let url = '';
    await new Promise<void>((resolve) => {
      srv = mssqlApp.listen(0, () => {
        url = `http://127.0.0.1:${(srv.address() as any).port}`;
        resolve();
      });
    });
    try {
      const res = await fetch(`${url}/api/g1/products`);
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.code, 50000);
      assert.match(body.message, /尚未配置|SQL Server/);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      isolatedMeta.close();
    }
  });

  it('DB-CFG-01..05: manual SKLAD & SaleData config persists to SQLite, masks passwords, syncs credentials, and resets to env defaults', async () => {
    const cfgMeta = new MetaStore(':memory:');
    const cfgApp = createTestImsApp({ dbMode: 'mssql', metaStore: cfgMeta });
    let srv!: http.Server;
    let url = '';
    await new Promise<void>((resolve) => {
      srv = cfgApp.listen(0, () => {
        url = `http://127.0.0.1:${(srv.address() as any).port}`;
        resolve();
      });
    });
    try {
      // 1. Initial GET masks password & defaults to unconfigured/env
      const initRes = await fetch(`${url}/api/ims/db-config`);
      const initBody = await initRes.json();
      assert.equal(initRes.status, 200);
      assert.equal('password' in initBody.data.sklad, false);
      assert.equal('password' in initBody.data.saledata, false);
      assert.equal(initBody.data.sklad.hasPassword, false);

      // 2. Test endpoint rejects numeric-only host cleanly without persisting
      const badTestRes = await fetch(`${url}/api/ims/db-config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'sklad',
          config: { server: '5258', port: 1433, database: 'SKLAD', user: 'sa', password: 'secret' },
        }),
      });
      const badTestBody = await badTestRes.json();
      assert.equal(badTestRes.status, 200);
      assert.equal(badTestBody.data.ok, false);
      assert.equal(badTestBody.data.errorCode, 'INVALID_HOST');

      // 3. PUT validates bad host with 422/42201
      const badPutRes = await fetch(`${url}/api/ims/db-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sklad: { server: '5258', port: 1433, database: 'SKLAD', user: 'sa', password: 'secret' },
        }),
      });
      const badPutBody = await badPutRes.json();
      assert.equal(badPutRes.status, 422);
      assert.equal(badPutBody.code, 42201);

      // 4. PUT saves SKLAD + SaleData overrides (syncPasswordFromSklad copies password cleanly)
      const saveRes = await fetch(`${url}/api/ims/db-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sklad: {
            server: '127.0.0.1',
            port: 1433,
            database: 'SKLAD',
            user: 'sa',
            password: 'MyStrongPassword!1',
            encrypt: true,
            trustServerCertificate: false,
          },
          saledata: {
            server: '127.0.0.1',
            port: 1433,
            database: 'SaleData',
            user: 'sa',
            syncPasswordFromSklad: true,
            encrypt: true,
            trustServerCertificate: false,
          },
        }),
      });
      const saveBody = await saveRes.json();
      assert.equal(saveRes.status, 200);
      assert.equal(saveBody.data.sklad.source, 'override');
      assert.equal(saveBody.data.saledata.source, 'override');
      assert.equal(saveBody.data.sklad.hasPassword, true);
      assert.equal(saveBody.data.saledata.hasPassword, true);
      assert.equal(saveBody.data.sklad.encrypt, true);
      assert.equal(saveBody.data.sklad.trustServerCertificate, false);
      assert.equal('password' in saveBody.data.sklad, false);
      assert.equal('password' in saveBody.data.saledata, false);
      assert.equal(cfgMeta.getDbOverride('saledata')?.password, 'MyStrongPassword!1');

      // 5. Partial update without password preserves stored password
      const partialRes = await fetch(`${url}/api/ims/db-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sklad: {
            server: '10.0.0.5',
            port: 14330,
            database: 'SKLAD_STORE',
            user: 'pos_user',
          },
        }),
      });
      const partialBody = await partialRes.json();
      assert.equal(partialRes.status, 200);
      assert.equal(partialBody.data.sklad.server, '10.0.0.5');
      assert.equal(partialBody.data.sklad.port, 14330);
      assert.equal(partialBody.data.sklad.hasPassword, true);
      assert.equal(cfgMeta.getDbOverride('sklad')?.password, 'MyStrongPassword!1');

      // 6. DELETE resets overrides back to env defaults
      const resetRes = await fetch(`${url}/api/ims/db-config`, { method: 'DELETE' });
      const resetBody = await resetRes.json();
      assert.equal(resetRes.status, 200);
      assert.notEqual(resetBody.data.sklad.source, 'override');
      assert.notEqual(resetBody.data.saledata.source, 'override');
      assert.equal(cfgMeta.getDbOverride('sklad'), null);
      assert.equal(cfgMeta.getDbOverride('saledata'), null);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      cfgMeta.close();
    }
  });
});
