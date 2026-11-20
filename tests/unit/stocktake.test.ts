import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVariance,
  normalizeStocktakeName,
  validateStocktakeLineInput,
} from '../../src/modules/stocktake/validators';

describe('M3 Stocktake Unit Tests', () => {
  it('AC-STK-01: generates Bratislava default name when omitted and truncates to 200 chars', () => {
    const fixedDate = new Date('2026-07-01T22:30:00.000Z'); // 2026-07-02 00:30 CEST in Bratislava!
    assert.equal(normalizeStocktakeName('', fixedDate), '盘点-2026-07-02');
    assert.equal(normalizeStocktakeName('x'.repeat(250), fixedDate).length, 200);
  });

  it('AC-STK-02: calculates Variance = CountedQty - SystemQty accurately', () => {
    assert.equal(calculateVariance(7, 10), -3);
    assert.equal(calculateVariance(10, 10), 0);
    assert.equal(calculateVariance(12, 10), 2);
    assert.equal(calculateVariance(5, null), 5); // B-33
  });

  it('AC-STK-03 & B-08: rejects negative/NaN countedQty or negative warningAt', () => {
    assert.throws(() => validateStocktakeLineInput({ barcode: '1001', countedQty: -1 }), { message: /非负/ });
    assert.throws(() => validateStocktakeLineInput({ barcode: '1001', countedQty: 'abc' }), { message: /非负/ });
    assert.throws(() => validateStocktakeLineInput({ barcode: '1001', countedQty: 5, warningAt: -2 }), { message: /非负/ });

    const ok = validateStocktakeLineInput({ barcode: ' 1001 ', countedQty: 7, warningAt: 5 });
    assert.equal(ok.barcode, '1001');
    assert.equal(ok.countedQty, 7);
    assert.equal(ok.warningAt, 5);
    assert.equal(ok.hasWarningAt, true);

    const noWarn = validateStocktakeLineInput({ barcode: '1001', countedQty: 0 });
    assert.equal(noWarn.countedQty, 0);
    assert.equal(noWarn.hasWarningAt, false);
  });
});
