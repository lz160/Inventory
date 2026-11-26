import { validationError } from '../../core/http/envelope';
import type { ChangeReceivingLine, ImportReceivingOrder, ImportedLine, ReceivingChanges } from './types';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('进货单数据格式无效');
  }
  return value as Record<string, unknown>;
}

export function receivingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw validationError('进货单操作编号无效');
  }
  return value.toLowerCase();
}

function string(value: unknown, max: number, field: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw validationError(`${field}须为${required ? '非空且' : ''}不超过 ${max} 个字符的文本`);
  }
  return value;
}

function number(value: unknown, field: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 999999999999) {
    throw validationError(`${field}数值无效`);
  }
  return value;
}

export function receivingVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw validationError('缺少有效的数据版本，请刷新后重试');
  }
  return value;
}

function importedLine(value: unknown): ImportedLine {
  const line = record(value);
  const seq = line.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < -2147483648 || seq > 2147483647) {
    throw validationError('商品序号无效');
  }
  return {
    seq,
    name: string(line.name, 500, '品名', true),
    chineseName: string(line.chineseName, 500, '中文品名'),
    unitPrice: number(line.unitPrice, '单价', -999999999999),
    discountPrice: number(line.discountPrice, '优惠价', -999999999999),
    barcode: string(line.barcode, 100, '条码'),
    expectedQty: number(line.expectedQty, '应收数量'),
    itemNo: string(line.itemNo, 200, '货号'),
    unitPrice2: number(line.unitPrice2, '单价2', -999999999999),
    supplier: string(line.supplier, 255, '供应商'),
    actualBilledPrice: number(line.actualBilledPrice, '实核单价', -999999999999),
  };
}

export function validateReceivingImport(value: unknown): ImportReceivingOrder {
  const body = record(value);
  if (body.mode !== 'new_order' && body.mode !== 'append' && body.mode !== 'replace') {
    throw validationError('无效的导入模式');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw validationError('请导入至少一项商品');
  }
  if (body.mode !== 'new_order' && !body.orderId) {
    throw validationError('请先选择进货单');
  }
  return {
    operationId: receivingId(body.operationId),
    mode: body.mode,
    title: string(body.title, 255, '进货单标题', true).trim(),
    orderId: body.mode === 'new_order' ? undefined : receivingId(body.orderId),
    version: body.mode === 'replace' ? receivingVersion(body.version) : undefined,
    items: body.items.map(importedLine),
  };
}

export function validateReceivingLineChange(value: unknown): ChangeReceivingLine {
  const body = record(value);
  const operationId = receivingId(body.operationId);
  if (body.delta !== undefined) {
    const delta = number(body.delta, '数量调整', -999999999999);
    if (delta === 0 || !Number.isInteger(delta) || (body.scan === true && delta < 0)) {
      throw validationError('数量调整无效');
    }
    return { operationId, delta, scan: body.scan === true };
  }

  const input = record(body.changes);
  const changes: ReceivingChanges = {};
  if ('receivedQty' in input) changes.receivedQty = number(input.receivedQty, '实收数量');
  if ('damagedQty' in input) changes.damagedQty = number(input.damagedQty, '破损数量');
  if ('actualBilledPrice' in input) {
    changes.actualBilledPrice = number(input.actualBilledPrice, '实核单价', -999999999999);
  }
  if ('notes' in input) changes.notes = string(input.notes, 2000, '备注');
  if (!Object.keys(changes).length) throw validationError('没有可保存的验货更改');
  return { operationId, changes, version: receivingVersion(body.version) };
}
