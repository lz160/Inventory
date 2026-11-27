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
import { getInventoryTable, runWithStoreContext, validateMssqlConfig, probeMssqlTarget } from '../../src/core/db/pool';
import type { DbOverrideRow } from '../../src/core/db/metaStore';
import type { G1Product, LowStockRow } from '../../src/modules/inventory/types';
import {
  buildCreateProductBody,
  buildEditProductPatch,
  computeInventoryPageSummary,
  computeLowStockSummary,
  createEmptyProductForm,
  createInitialEditForm,
  filterLowStockRows,
  hasCostData,
  parsePipeProductName,
  resolveProductDisplayLines,
} from '../../src/modules/inventory/viewHelpers';

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

  it('selects the warehouse table from the active store without affecting other stores', async () => {
    const warehouseOverride: DbOverrideRow = {
      target: 'sklad',
      server: 'warehouse.internal',
      port: 1433,
      database_name: 'Sklad',
      username: 'reader',
      password: '',
      encrypt: true,
      trust_server_certificate: false,
      updated_at: '2026-11-26T00:00:00.000Z',
      inventory_table: 'sklad1',
    };
    const overrides = {
      getDbOverride: (target: string, storeId?: number | null) =>
        target === 'sklad' && storeId === 2 ? warehouseOverride : null,
    };
    async function queryTable(storeId: number) {
      return runWithStoreContext(storeId, async () => {
        await Promise.resolve();
        return getInventoryTable();
      }, overrides);
    }

    assert.equal(getInventoryTable(), '[dbo].[g1]');
    assert.deepEqual(await Promise.all([queryTable(2), queryTable(1)]), ['[dbo].[sklad1]', '[dbo].[g1]']);
    assert.equal(getInventoryTable(), '[dbo].[g1]');
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

  it('viewHelpers compute real KPI summary, filter low-stock rows, and build valid G1 patches', () => {
    const baseProduct: G1Product = {
      Nazov: 'Cola 500ml',
      Cena: 1.23,
      PovCena: 1.5,
      Barcode: '8581000000001',
      Mnozstvo: 1,
      Kod: 'DRK-01',
      Element: '',
      Class: '',
      Reserved: 0,
      Surplus: 10,
      VIPnoDiscount: 0,
      barcode2nd: '8581000000099',
      conv2ndtobarcode: 24,
      barcodeType: 0,
      DPHtype: 1,
      PurchasePrice: 0.7,
      Dozen: 12,
      Box: 24,
      menupackage: 'bal',
      Picture: '',
      Cena2: 0.8,
      WarningAt: 5,
      MoreSurplus: '',
      ExpiryDate: '2027-01-01',
      PurchaseCountry: 'SK',
      Supplier: 'DrinkDist',
      Companions: '',
      NotNewForCloud: 1,
      IsUpdateCloud: 0,
      InstallDate: '2026-11-01T00:00:00.000Z',
      Shelves: 4,
      LastInstallQty: 24,
      name_zh: '可乐 500ml',
      category: 'beverage',
    };
    const lowProduct: G1Product = { ...baseProduct, Barcode: '8581000000002', Surplus: 3, WarningAt: 5, Cena: 2.46, Cena2: 1.0 };
    const outProduct: G1Product = { ...baseProduct, Barcode: '8581000000003', Surplus: -2, WarningAt: 5, Cena: 0, Cena2: 0 };

    const noCostPricedProduct: G1Product = { ...baseProduct, Barcode: '8581000000004', Surplus: 0, WarningAt: 5, Cena: 1.23, Cena2: 0 };

    assert.equal(hasCostData(0), false);
    assert.equal(hasCostData(-1), false);
    assert.equal(hasCostData(null), false);
    assert.equal(hasCostData(undefined), false);
    assert.equal(hasCostData(Number.NaN), false);
    assert.equal(hasCostData(0.01), true);
    assert.equal(hasCostData(1.5), true);

    const summary = computeInventoryPageSummary([baseProduct, lowProduct, outProduct, noCostPricedProduct], 42, 7);
    assert.equal(summary.totalMatching, 42);
    assert.equal(summary.lowStockTotal, 7);
    assert.equal(summary.pageInCount, 1);
    assert.equal(summary.pageLowCount, 1);
    assert.equal(summary.pageOutCount, 2);
    // Negative surplus is clamped to 0 for valuation: 10*1.23 + 3*2.46 = 19.68
    assert.ok(Math.abs(summary.pageStockValueRetail - 19.68) < 1e-6);
    assert.ok(Math.abs(summary.pageStockValueCost - 11.0) < 1e-6);
    // Margin average excludes costless items (noCostPricedProduct has Cena2=0) and averages the 2 products with cost data: (0.2 + 0.5) / 2 = 0.35
    assert.ok(Math.abs((summary.pageAvgNetMarginRate ?? 0) - 0.35) < 1e-6);

    const lowRows: LowStockRow[] = [
      { ...lowProduct, Gap: 2 },
      { ...outProduct, Barcode: '8581000000009', Nazov: 'Chips', name_zh: '薯片', Supplier: 'SnackCo', Cena2: 1.5, Gap: 4 },
    ];
    assert.equal(filterLowStockRows(lowRows, '薯片', '').length, 1);
    assert.equal(filterLowStockRows(lowRows, '', 'DrinkDist').length, 1);
    const lowSum = computeLowStockSummary(lowRows);
    assert.equal(lowSum.alertCount, 2);
    assert.equal(lowSum.outOfStockCount, 1);
    assert.equal(lowSum.totalGapQty, 6);
    assert.ok(Math.abs(lowSum.estimatedRestockCost - (2 * 1.0 + 4 * 1.5)) < 1e-6);

    const editForm = createInitialEditForm(baseProduct);
    editForm.Shelves = '8';
    editForm.Reserved = true;
    const patch = buildEditProductPatch(editForm);
    // Must pass backend editable whitelist cleanly and exclude Barcode/WarningAt/InstallDate
    const sanitized = filterEditablePatch(patch);
    assert.equal(sanitized.Shelves, 8);
    assert.equal(sanitized.Reserved, 1);
    assert.equal('WarningAt' in patch, false);

    const createForm = createEmptyProductForm();
    createForm.Barcode = '8582222222222';
    createForm.Nazov = 'New SKU';
    createForm.category = 'food_snack';
    createForm.Cena = '3.69';
    const body = buildCreateProductBody(createForm);
    assert.equal(body.category, 'food_snack');
    assert.equal(body.Cena, 3.69);
  });

  it('parsePipeProductName and resolveProductDisplayLines hide | and place trailing content on line 2', () => {
    assert.deepEqual(parsePipeProductName('Dámske tričko | 女式纯棉T恤'), {
      primary: 'Dámske tričko',
      secondary: '女式纯棉T恤',
    });
    assert.deepEqual(parsePipeProductName('Coca-Cola|500ml'), {
      primary: 'Coca-Cola',
      secondary: '500ml',
    });
    assert.deepEqual(parsePipeProductName('Item A | Spec 1 | Spec 2'), {
      primary: 'Item A',
      secondary: 'Spec 1 Spec 2',
    });
    assert.deepEqual(parsePipeProductName('Trailing | '), {
      primary: 'Trailing',
      secondary: null,
    });
    assert.deepEqual(parsePipeProductName('| LeadingOnly'), {
      primary: 'LeadingOnly',
      secondary: null,
    });
    assert.deepEqual(parsePipeProductName('Plain Product'), {
      primary: 'Plain Product',
      secondary: null,
    });
    assert.deepEqual(parsePipeProductName(''), {
      primary: '',
      secondary: null,
    });

    assert.deepEqual(resolveProductDisplayLines('Dámske tričko | 女式T恤', '', 'zh'), {
      line1: 'Dámske tričko',
      line2: '女式T恤',
      line3: null,
    });
    assert.deepEqual(resolveProductDisplayLines('Dámske tričko | 500ml', '女式T恤 | 纯棉', 'zh'), {
      line1: '女式T恤',
      line2: '纯棉',
      line3: 'Dámske tričko 500ml',
    });
    assert.deepEqual(resolveProductDisplayLines('Dámske tričko | 500ml', '女式T恤', 'sk'), {
      line1: 'Dámske tričko',
      line2: '500ml',
      line3: null,
    });
  });
});

