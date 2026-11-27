import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  calculateItemStatus,
  checkPriceDiscrepancy,
  calculateOrderMetrics,
  cleanNumber,
  parseImportText,
  PURCHASE_IMPORT_HEADERS,
  getSamplePurchaseItems,
  PurchaseItem,
  sortPurchaseOrders,
  isOrderCompleted,
  exportToXlsx,
  exportToPosImportXlsx,
  exportToAuditResultXlsx,
} from './reconciliation.ts';

test('calculateItemStatus correctly categorizes quantities', () => {
  assert.equal(calculateItemStatus(10, 0), 'pending');
  assert.equal(calculateItemStatus(10, 5), 'partial');
  assert.equal(calculateItemStatus(10, 10), 'matched');
  assert.equal(calculateItemStatus(10, 12), 'excess');
});

test('checkPriceDiscrepancy accurately checks difference and percentage', () => {
  const item: Pick<PurchaseItem, 'unitPrice' | 'discountPrice' | 'unitPrice2' | 'actualBilledPrice'> = {
    unitPrice: 100,
    discountPrice: 80,
    unitPrice2: 75,
    actualBilledPrice: 80,
  };

  // Matched against discountPrice
  const res1 = checkPriceDiscrepancy(item, 'discountPrice');
  assert.equal(res1.status, 'matched');
  assert.equal(res1.diff, 0);

  // Discrepancy against unitPrice2 (80 vs 75 => +5)
  const res2 = checkPriceDiscrepancy(item, 'unitPrice2');
  assert.equal(res2.status, 'discrepancy');
  assert.equal(res2.diff, 5);
  assert.equal(res2.diffPercent, 6.7);

  // Unconfirmed
  const unconfirmedItem = { ...item, actualBilledPrice: NaN };
  const res3 = checkPriceDiscrepancy(unconfirmedItem, 'discountPrice');
  assert.equal(res3.status, 'unconfirmed');
});

test('cleanNumber strips currencies, commas, and extra spaces', () => {
  assert.equal(cleanNumber('¥1,540.50'), 1540.5);
  assert.equal(cleanNumber('$890.00'), 890);
  assert.equal(cleanNumber('  120  '), 120);
  assert.equal(cleanNumber(undefined), 0);
  assert.equal(cleanNumber(250), 250);
});

test('parseImportText parses 10-column TSV/Excel copied lines', () => {
  const raw = `序号\t品名\t中文\t单价\t优惠价\t条码\t数量\t货号\t单价2\t供应商
1\tSK-II Facial 230ml\t神仙水\t1540\t1180\t4979004070008\t24\tSKI-FTE\t1150\t日韩社
2\tEstee Lauder 50ml\t小棕瓶\t890\t620\t0887167485488\t50\tEL-ANR\t610\t亚太免税`;

  const items = parseImportText(raw);
  assert.equal(items.length, 2);
  assert.equal(items[0].seq, 1);
  assert.equal(items[0].name, 'SK-II Facial 230ml');
  assert.equal(items[0].chineseName, '神仙水');
  assert.equal(items[0].unitPrice, 1540);
  assert.equal(items[0].discountPrice, 1180);
  assert.equal(items[0].barcode, '4979004070008');
  assert.equal(items[0].expectedQty, 24);
  assert.equal(items[0].itemNo, 'SKI-FTE');
  assert.equal(items[0].unitPrice2, 1150);
  assert.equal(items[0].supplier, '日韩社');
});

test('receiving import preserves fractional quantities and identifiers, and rejects mismatched columns', () => {
  const row = ['1', '测试商品', '', '4', '0', '0012345678905', '1.5', '000087', '3.25', '供应商'];
  const [item] = parseImportText([PURCHASE_IMPORT_HEADERS, row].map(cells => cells.join('\t')).join('\n'));
  assert.equal(item.expectedQty, 1.5);
  assert.equal(item.barcode, '0012345678905');
  assert.equal(item.itemNo, '000087');

  const headers = [...PURCHASE_IMPORT_HEADERS];
  [headers[7], headers[8]] = [headers[8], headers[7]];
  assert.throws(() => parseImportText(headers.join('\t')), /表头或列顺序/);
});

test('receiving import rejects an audit export and can import a fractional POS export', async () => {
  const item = { ...getSamplePurchaseItems()[0], receivedQty: 1.75, barcode: '0012345678905', itemNo: '000087' };
  for (const [exporter, canImport] of [[exportToPosImportXlsx, true], [exportToAuditResultXlsx, false]] as const) {
    const blob = exporter([item], '测试');
    const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const text = XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]], { FS: '\t' });
    if (canImport) {
      const [row] = parseImportText(text);
      assert.equal(row.expectedQty, 1.75);
      assert.equal(row.barcode, item.barcode);
      assert.equal(row.itemNo, item.itemNo);
    } else {
      assert.throws(() => parseImportText(text), /差异核对报告不能导入/);
    }
  }
});

test('calculateOrderMetrics aggregates values properly', () => {
  const sampleItems = getSamplePurchaseItems();
  const metrics = calculateOrderMetrics(sampleItems, 'discountPrice');

  assert.equal(metrics.totalItems, 8);
  assert.equal(metrics.matchedItems > 0, true);
  assert.equal(metrics.totalExpectedQty > 0, true);
  assert.equal(metrics.totalReceivedQty > 0, true);
  assert.equal(metrics.totalExpectedAmount > 0, true);
  assert.equal(typeof metrics.progressPercent, 'number');
});

test('sortPurchaseOrders orders incomplete first, then completed by earlier completedAt', () => {
  const orders = [
    {
      id: 'o-completed-late',
      title: '晚完成单',
      createdAt: '2026-11-09',
      completedAt: '2026-11-09 15:00:00',
      isActive: true,
      items: [{ id: '1', seq: 1, name: 'A', chineseName: '', unitPrice: 10, discountPrice: 10, barcode: '1', expectedQty: 10, receivedQty: 10, damagedQty: 0, itemNo: '', unitPrice2: 0, actualBilledPrice: 10, notes: '', supplier: '' }],
    },
    {
      id: 'o-uncompleted-1',
      title: '未完成单1',
      createdAt: '2026-11-09',
      isActive: true,
      items: [{ id: '2', seq: 1, name: 'B', chineseName: '', unitPrice: 10, discountPrice: 10, barcode: '2', expectedQty: 10, receivedQty: 5, damagedQty: 0, itemNo: '', unitPrice2: 0, actualBilledPrice: 10, notes: '', supplier: '' }],
    },
    {
      id: 'o-completed-early',
      title: '早完成单',
      createdAt: '2026-11-09',
      completedAt: '2026-11-09 09:00:00',
      isActive: true,
      items: [{ id: '3', seq: 1, name: 'C', chineseName: '', unitPrice: 10, discountPrice: 10, barcode: '3', expectedQty: 5, receivedQty: 5, damagedQty: 0, itemNo: '', unitPrice2: 0, actualBilledPrice: 10, notes: '', supplier: '' }],
    },
  ];

  const sorted = sortPurchaseOrders(orders as any);
  assert.equal(sorted[0].id, 'o-uncompleted-1'); // Uncompleted on top
  assert.equal(sorted[1].id, 'o-completed-early'); // Completed early
  assert.equal(sorted[2].id, 'o-completed-late'); // Completed late
});

test('exportToXlsx generates a valid spreadsheet Blob with openxml mime type', async () => {
  const items = getSamplePurchaseItems();
  const blob = exportToXlsx(items, '测试进货单批次');
  assert.equal(blob instanceof Blob, true);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(blob.size > 1000, true);

  // Validate that the binary content starts with standard zip/xlsx magic bytes (PK\x03\x04)
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  assert.equal(bytes[0], 0x50); // 'P'
  assert.equal(bytes[1], 0x4b); // 'K'
});

test('exportToPosImportXlsx matches standard 10-column POS format and uses receivedQty', async () => {
  const items: PurchaseItem[] = [
    {
      id: 'item-1',
      seq: 1,
      name: 'SK-II神仙水',
      chineseName: '神仙水',
      unitPrice: 1540,
      discountPrice: 1180,
      barcode: '4979004070008',
      expectedQty: 24,
      receivedQty: 20, // Received 20
      damagedQty: 0,
      itemNo: 'SKI-FTE',
      unitPrice2: 1150,
      actualBilledPrice: 1180,
      notes: '',
      supplier: '日韩美妆社',
    },
    {
      id: 'item-2',
      seq: 2,
      name: '小棕瓶50ml',
      chineseName: '小棕瓶',
      unitPrice: 890,
      discountPrice: 620,
      barcode: '0887167485488',
      expectedQty: 50,
      receivedQty: 0, // Unreceived (0) - must still be exported
      damagedQty: 0,
      itemNo: 'EL-ANR',
      unitPrice2: 610,
      actualBilledPrice: 620,
      notes: '',
      supplier: '亚太免税',
    },
  ];

  const blob = exportToPosImportXlsx(items, 'POS导出测试');
  assert.equal(blob instanceof Blob, true);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const arrayBuffer = await blob.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<any>(sheet);

  assert.equal(jsonRows.length, 2);

  // Validate row 1
  assert.equal(jsonRows[0]['序号'], 1);
  assert.equal(jsonRows[0]['品名'], 'SK-II神仙水');
  assert.equal(jsonRows[0]['条码'], '4979004070008');
  assert.equal(jsonRows[0]['数量'], 20); // receivedQty
  assert.equal(jsonRows[0]['供应商'], '日韩美妆社');

  // Validate row 2 (with receivedQty === 0 included)
  assert.equal(jsonRows[1]['序号'], 2);
  assert.equal(jsonRows[1]['条码'], '0887167485488');
  assert.equal(jsonRows[1]['数量'], 0); // receivedQty 0 preserved
});


