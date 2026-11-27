import type { ReceivingLineResult, ReceivingOrder } from './types';

export function normalizeReceivingOrder(raw: unknown): ReceivingOrder {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('进货单数据格式无效');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) {
    throw new Error('进货单缺少有效编号');
  }
  return {
    ...(record as unknown as ReceivingOrder),
    items: Array.isArray(record.items) ? record.items : [],
  };
}

export function normalizeReceivingOrders(raw: unknown): ReceivingOrder[] {
  if (!Array.isArray(raw)) {
    throw new Error('进货单列表格式无效');
  }
  return raw.map((entry) => normalizeReceivingOrder(entry));
}

export function normalizeReceivingLineResult(raw: unknown): ReceivingLineResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('验货明细返回格式无效');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.orderId !== 'string' || !record.orderId || !record.item || typeof record.item !== 'object') {
    throw new Error('验货明细返回缺少必要字段');
  }
  return record as unknown as ReceivingLineResult;
}
