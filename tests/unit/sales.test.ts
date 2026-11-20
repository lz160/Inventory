import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bratislavaLocalMidnightToUtc,
  clampLimit,
  computeRestockMetrics,
  getIsoWeekString,
  resolveDateRange,
  sortRestockRows,
  toBratislavaLocalDate,
  validateDateParam,
} from '../../src/modules/sales/analytics';
import { matchCategoryByName, normalizeCategoryText } from '../../src/modules/sales/category-rules';

describe('M2 Sales Analytics Unit Tests', () => {
  it('B-11 & B-12: strict YYYY-MM-DD validation and reversed range behavior', () => {
    assert.equal(validateDateParam('2026-08-15'), '2026-08-15');
    assert.throws(() => validateDateParam('2026/08/15'), { message: /YYYY-MM-DD/ });
    assert.throws(() => validateDateParam('2026-13-01'), { message: /YYYY-MM-DD/ });
    assert.throws(() => validateDateParam('2026-02-30'), { message: /YYYY-MM-DD/ });

    const rev = resolveDateRange('2026-09-10', '2026-09-01');
    assert.equal(rev.reversed, true);
  });

  it('B-13 & AC-SAL-03: DST-safe Europe/Bratislava day boundaries', () => {
    // Summer CEST (UTC+2): 2026-07-01 00:00:00 Bratislava = 2026-06-30 22:00:00 UTC
    const summerStart = bratislavaLocalMidnightToUtc('2026-07-01');
    assert.equal(summerStart.toISOString(), '2026-06-30T22:00:00.000Z');
    assert.equal(toBratislavaLocalDate('2026-07-01T21:59:59.000Z'), '2026-07-01');
    assert.equal(toBratislavaLocalDate('2026-07-01T22:00:00.000Z'), '2026-07-02');

    // Winter CET (UTC+1): 2026-01-15 00:00:00 Bratislava = 2026-01-14 23:00:00 UTC
    const winterStart = bratislavaLocalMidnightToUtc('2026-01-15');
    assert.equal(winterStart.toISOString(), '2026-01-14T23:00:00.000Z');
    assert.equal(toBratislavaLocalDate('2026-01-15T22:59:59.000Z'), '2026-01-15');
  });

  it('B-14 & AC-SAL-04: ISO-8601 week grouping across year boundaries', () => {
    // 2024-12-30 (Mon) .. 2025-01-05 (Sun) contains Jan 2 Thu -> 2025-W01
    assert.equal(getIsoWeekString('2024-12-30'), '2025-W01');
    assert.equal(getIsoWeekString('2025-01-05'), '2025-W01');

    // 2026-12-28 (Mon) .. 2027-01-03 (Sun) contains Dec 31 Thu -> same ISO week 2026-W53
    assert.equal(getIsoWeekString('2026-12-28'), '2026-W53');
    assert.equal(getIsoWeekString('2027-01-03'), '2026-W53');
    assert.equal(getIsoWeekString('2026-08-20'), '2026-W34');
  });

  it('B-17: limit clamping between 1 and 200 without throwing', () => {
    assert.equal(clampLimit(0, 20, 200), 1);
    assert.equal(clampLimit(1000, 20, 200), 200);
    assert.equal(clampLimit('bad', 20, 200), 20);
  });

  it('AC-SAL-07 & AC-SAL-08: restock formulas and null DaysLeft sorting last', () => {
    const m = computeRestockMetrics(60, 10, 30);
    assert.equal(m.DailyRate, 2);
    assert.equal(m.DaysLeft, 5);
    assert.equal(m.SuggestedQty, 50);

    const zero = computeRestockMetrics(0, 10, 30);
    assert.equal(zero.DailyRate, 0);
    assert.equal(zero.DaysLeft, null);
    assert.equal(zero.SuggestedQty, 0);

    const sorted = sortRestockRows([
      { Barcode: 'B', Nazov: null, Surplus: 10, WarningAt: 0, Cena: 1, Cena2: 0, SoldQty: 0, DailyRate: 0, DaysLeft: null, SuggestedQty: 0 },
      { Barcode: 'A', Nazov: null, Surplus: 10, WarningAt: 0, Cena: 1, Cena2: 0, SoldQty: 60, DailyRate: 2, DaysLeft: 5.0, SuggestedQty: 50 },
    ]);
    assert.equal(sorted[0].Barcode, 'A');
    assert.equal(sorted[1].Barcode, 'B');
  });

  it('B-20 & §5.3: Slovak diacritics normalization and category keyword matching', () => {
    assert.equal(normalizeCategoryText('Dámske  tričko   bavlna'), 'damske tricko bavlna');
    assert.equal(matchCategoryByName('Dámske tričko bavlna'), 'w_tshirt');
    assert.equal(matchCategoryByName('Pánske nohavice slim'), 'm_pants');
    assert.equal(matchCategoryByName('Detská bunda zimná'), 'kid_jacket');
    assert.equal(matchCategoryByName('Kuchynský nôž nerezový'), 'home_kitchen');
    assert.equal(matchCategoryByName('Unrecognizable XYZ Item 999'), null);
  });
});
