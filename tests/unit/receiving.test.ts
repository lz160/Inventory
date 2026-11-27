import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { normalizeReceivingLineResult, normalizeReceivingOrder, normalizeReceivingOrders } from '../../src/modules/receiving/normalize';
import { validateReceivingImport, validateReceivingLineChange } from '../../src/modules/receiving/validation';
import { ImsApiError, parseImsEnvelope } from '../../src/utils/imsApi';

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

test('parseImsEnvelope rejects non-JSON 200 HTML fallback and malformed JSON envelopes', () => {
  assert.throws(
    () => parseImsEnvelope(200, true, '<!doctype html><html></html>'),
    (err: unknown) => err instanceof ImsApiError && err.code === 50000
  );
  assert.throws(
    () => parseImsEnvelope(200, true, ''),
    (err: unknown) => err instanceof ImsApiError && err.code === 50000
  );
  assert.throws(
    () => parseImsEnvelope(200, true, '{"ok":true}'),
    (err: unknown) => err instanceof ImsApiError && err.code === 50000
  );
  assert.throws(
    () => parseImsEnvelope(200, true, '{"code":40300,"message":"无权访问"}'),
    (err: unknown) => err instanceof ImsApiError && err.code === 40300 && err.message === '无权访问'
  );
  assert.deepEqual(parseImsEnvelope(200, true, '{"code":0,"data":[]}'), []);
  assert.equal(parseImsEnvelope(204, true, ''), undefined);
});

test('receiving payload normalizers reject non-arrays and default missing items to empty array', () => {
  assert.throws(() => normalizeReceivingOrders(undefined), /格式无效/);
  assert.throws(() => normalizeReceivingOrders({}), /格式无效/);
  assert.throws(() => normalizeReceivingOrder(null), /格式无效/);
  assert.throws(() => normalizeReceivingOrder({ title: 'missing id' }), /编号/);
  assert.throws(() => normalizeReceivingLineResult({ orderId: 'o1' }), /缺少必要字段/);

  const normalized = normalizeReceivingOrders([{ id: 'ord-1', title: '货单1', version: 1 }]);
  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0].items, []);
});

