import type { PurchaseItem, PurchaseOrder } from '../../utils/reconciliation';

export type ReceivingLine = PurchaseItem & { version: number };
export type ReceivingOrder = Omit<PurchaseOrder, 'items'> & {
  version: number;
  items: ReceivingLine[];
};

export type ReceivingChanges = Partial<Pick<
  PurchaseItem, 'receivedQty' | 'damagedQty' | 'actualBilledPrice' | 'notes'
>>;

export type ReceivingMode = 'new_order' | 'replace' | 'append';

export type ImportedLine = Pick<
  PurchaseItem,
  'seq' | 'name' | 'chineseName' | 'unitPrice' | 'discountPrice' | 'barcode' |
  'expectedQty' | 'itemNo' | 'unitPrice2' | 'supplier' | 'actualBilledPrice'
>;

export interface ImportReceivingOrder {
  operationId: string;
  mode: ReceivingMode;
  title: string;
  orderId?: string;
  version?: number;
  items: ImportedLine[];
}

export type ChangeReceivingLine = {
  operationId: string;
} & (
  { delta: number; scan: boolean } |
  { changes: ReceivingChanges; version: number }
);

export interface ReceivingLineResult {
  item: ReceivingLine;
  orderId: string;
  version: number;
  completedAt?: string;
}
