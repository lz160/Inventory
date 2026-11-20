import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVatMetrics,
  clampPagination,
  filterEditablePatch,
  getStockStatus,
  normalizeBarcode,
  validateCreateProductPayload,
  validateSort,
} from '../../src/modules/inventory/validators';
import {
  buildInventoryImportTemplateBytes,
  parseInventoryWorkbook,
  resolveCategoryCode,
} from '../../src/modules/inventory/excelTemplate';
import { validateMssqlConfig, probeMssqlTarget } from '../../src/core/db/pool';

describe('M1 Inventory Unit Tests', () => {
  it('AC-INV-03 & B-07/B-33: stock status is strictly mutually exclusive across in/low/out', () => {
    const surpluses = [-1, 0, 3, 5, 6, null];
    const warnings = [0, 5];

    for (const s of surpluses) {
      for (const w of warnings) {
        const st = getStockStatus(s, w);
        const isOut = (s ?? 0) <= 0;
        const isLow = w > 0 && (s ?? 0) > 0 && (s ?? 0) <= w;
        const isIn = (s ?? 0) > 0 && !(w > 0 && (s ?? 0) <= w);

        assert.equal([isOut, isLow, isIn].filter(Boolean).length, 1);
        if (isOut) assert.equal(st, 'out');
        if (isLow) assert.equal(st, 'low');
        if (isIn) assert.equal(st, 'in');
      }
    }
  });

  it('AC-SAL-09 & AC-SAL-10: VAT 23% margin formulas and zero-division protection', () => {
    const m = calculateVatMetrics(123, 80);
    assert.equal(m.grossMarginWithVat, 43);
    assert.ok(Math.abs(m.netPrice - 100) < 1e-6);
    assert.ok(Math.abs(m.netMargin - 20) < 1e-6);
    assert.ok(Math.abs((m.netMarginRate ?? 0) - 0.2) < 1e-6);

    const zero = calculateVatMetrics(0, 10);
    assert.equal(zero.netPrice, 0);
    assert.equal(zero.netMarginRate, null);
  });

  it('B-01, B-02, B-03: barcode trimming and length bounds', () => {
    assert.equal(normalizeBarcode('  12345  '), '12345');
    assert.throws(() => normalizeBarcode('   '), { message: /不能为空/ });
    assert.throws(() => normalizeBarcode('12345678901234'), { message: /13 位/ });
  });

  it('R-INV-3 & B-07: create defaults allow negative Surplus and set DPHtype=1, NotNewForCloud=1', () => {
    const nowIso = '2026-06-01T12:00:00.000Z';
    const created = validateCreateProductPayload(
      { Barcode: ' 9999999999999 ', Nazov: '  Test Neg  ', Surplus: -2, WarningAt: 99 },
      nowIso
    );
    assert.equal(created.Barcode, '9999999999999');
    assert.equal(created.Nazov, 'Test Neg');
    assert.equal(created.Surplus, -2);
    assert.equal(created.DPHtype, 1);
    assert.equal(created.NotNewForCloud, 1);
    assert.equal(created.Mnozstvo, 0);
    assert.equal(created.InstallDate, nowIso);
    // WarningAt cannot be injected via M1 create either because it is not in G1_EDITABLE_FIELDS
    assert.equal(created.WarningAt, 0);
  });

  it('AC-INV-06: filterEditablePatch blocks WarningAt and Barcode only updates', () => {
    assert.throws(() => filterEditablePatch({ WarningAt: 5 }), { message: /WarningAt/ });
    assert.throws(() => filterEditablePatch({ Barcode: 'x' }), { message: /没有可更新/ });
    const valid = filterEditablePatch({ Nazov: 'New Name', Cena: '15.5', WarningAt: 10 });
    assert.deepEqual(valid, { Nazov: 'New Name', Cena: 15.5 });
  });


  it('B-16 & B-18: sort whitelist and pagination bounds', () => {
    const inj = validateSort('Surplus;DROP TABLE g1', 'DESC');
    assert.equal(inj.column, 'Barcode');
    assert.equal(inj.direction, 'DESC');

    assert.deepEqual(clampPagination(0, 0), { page: 1, pageSize: 1 });
    assert.deepEqual(clampPagination(5, 10000), { page: 5, pageSize: 200 });
  });

  it('Synchronized Excel template builds and round-trips category codes and catches invalid rows', () => {
    const bytes = buildInventoryImportTemplateBytes();
    const parsed = parseInventoryWorkbook(bytes);
    assert.equal(parsed.errorCount, 0);
    assert.equal(parsed.validItems.length, 1);
    assert.equal(parsed.validItems[0].Barcode, '8580000000001');
    assert.equal(parsed.validItems[0].category, 'food_snack');
    assert.equal(parsed.validItems[0].Surplus, 24);

    assert.equal(resolveCategoryCode('食品零食'), 'food_snack');
    assert.equal(resolveCategoryCode('Potraviny a pochutiny'), 'food_snack');
  });

  it('MSSQL config validation rejects purely numeric host like 5258 immediately without hanging', async () => {
    const prevServer = process.env.MSSQL_SKLAD_SERVER;
    const prevPort = process.env.MSSQL_SKLAD_PORT;
    const prevUser = process.env.MSSQL_SKLAD_USER;
    const prevDb = process.env.MSSQL_SKLAD_DATABASE;
    try {
      process.env.MSSQL_SKLAD_SERVER = '5258';
      process.env.MSSQL_SKLAD_PORT = '5258';
      process.env.MSSQL_SKLAD_USER = '5258';
      process.env.MSSQL_SKLAD_DATABASE = '5258';

      const val = validateMssqlConfig('sklad');
      assert.equal(val.valid, false);
      assert.equal(val.errorCode, 'INVALID_HOST');

      const start = Date.now();
      const probe = await probeMssqlTarget('sklad');
      const elapsed = Date.now() - start;
      assert.equal(probe.ok, false);
      assert.equal(probe.errorCode, 'INVALID_HOST');
      assert.ok(elapsed < 500, `Expected fast fail < 500ms, got ${elapsed}ms`);
    } finally {
      if (prevServer === undefined) delete process.env.MSSQL_SKLAD_SERVER;
      else process.env.MSSQL_SKLAD_SERVER = prevServer;
      if (prevPort === undefined) delete process.env.MSSQL_SKLAD_PORT;
      else process.env.MSSQL_SKLAD_PORT = prevPort;
      if (prevUser === undefined) delete process.env.MSSQL_SKLAD_USER;
      else process.env.MSSQL_SKLAD_USER = prevUser;
      if (prevDb === undefined) delete process.env.MSSQL_SKLAD_DATABASE;
      else process.env.MSSQL_SKLAD_DATABASE = prevDb;
    }
  });
});
