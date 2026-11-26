import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { validateReceivingImport, validateReceivingLineChange } from '../../src/modules/receiving/validation';

test('receiving import preserves Unicode, barcode leading zeros, quantity, and decimal price', () => {
  const order = validateReceivingImport({
    operationId: randomUUID(), title: '   测试单   ', mode: 'new_order',
    storeId: 123, // Store routing comes from the authenticated session.
    items: [{
      seq: 1, name: '货品', chineseName: '测试', barcode: '0000123456', expectedQty: 1.25,
      itemNo: 'A', supplier: '供应商', unitPrice: 1.23456, discountPrice: 0,
      unitPrice2: 1.23456, actualBilledPrice: 1.23456, receivedQty: 999,
    }],
  });
  assert.equal(order.title, '测试单');
  assert.equal(order.items[0].barcode, '0000123456');
  assert.equal(order.items[0].expectedQty, 1.25);
  assert.equal(order.items[0].unitPrice, 1.23456);
  assert.equal('receivedQty' in order.items[0], false);
  assert.equal('storeId' in order, false);
});

test('scan rejects a negative increment and a manual edit requires a version', () => {
  const operationId = randomUUID();
  assert.throws(() => validateReceivingLineChange({ operationId, delta: -1, scan: true }), /数量调整无效/);
  assert.throws(() => validateReceivingLineChange({ operationId, changes: { receivedQty: 7 } }), /数据版本/);
  assert.deepEqual(
    validateReceivingLineChange({ operationId, changes: { receivedQty: 0, notes: '', seq: 3 }, version: 2 }),
    { operationId, changes: { receivedQty: 0, notes: '' }, version: 2 }
  );
});
