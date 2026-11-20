import * as XLSX from 'xlsx';

export interface PurchaseItem {
  id: string;
  seq: number; // 序号
  name: string; // 品名
  chineseName: string; // 中文
  unitPrice: number; // 单价
  discountPrice: number; // 优惠价
  barcode: string; // 条码
  expectedQty: number; // 数量
  itemNo: string; // 货号
  unitPrice2: number; // 单价2
  supplier: string; // 供应商

  // 所属进货单
  orderId?: string; // 关联单据ID
  orderTitle?: string; // 关联单据名称

  // 核对与验货状态
  receivedQty: number; // 实收数量
  damagedQty: number; // 破损/残次数量
  actualBilledPrice: number; // 实收核对单价
  notes: string; // 备注说明 (如：少发2件、包装破损、已联系厂家补发)
  lastScannedAt?: string; // 最近核验时间
}

export interface PurchaseOrder {
  id: string;
  title: string; // 对货单标题 / 批次号
  supplier?: string; // 供应商
  createdAt: string; // 创建日期
  completedAt?: string; // 核验完成时间 (ISO或格式化时间)
  isActive: boolean; // 是否处于同时核对激活状态
  items: PurchaseItem[]; // 包含的商品清单
}

export type ItemStatus = 'pending' | 'partial' | 'matched' | 'excess';

export interface PriceCheckResult {
  status: 'matched' | 'discrepancy' | 'unconfirmed';
  diff: number; // actual - benchmark
  diffPercent: number;
  benchmarkPrice: number;
}

export interface OrderMetrics {
  totalItems: number; // 总品类数
  matchedItems: number; // 齐套品类数
  partialItems: number; // 部分到货品类数
  pendingItems: number; // 未到货品类数
  excessItems: number; // 超收到货品类数
  totalExpectedQty: number; // 应收总件数
  totalReceivedQty: number; // 实收总件数
  totalDamagedQty: number; // 破损总件数
  qtyDifference: number; // 数量差异 (实收 - 应收)
  totalExpectedAmount: number; // 应付预期总额 (基于优惠价或单价)
  totalActualAmount: number; // 实核金额 (基于实收数量 * 实核单价)
  amountDifference: number; // 金额总偏差 (实核 - 应付)
  priceDiscrepancyCount: number; // 价格异常品类数
  progressPercent: number; // 核验完成百分比
}

/**
 * 计算单项物品的到货状态
 */
export function calculateItemStatus(expectedQty: number, receivedQty: number): ItemStatus {
  if (receivedQty <= 0) return 'pending';
  if (receivedQty < expectedQty) return 'partial';
  if (receivedQty === expectedQty) return 'matched';
  return 'excess';
}

/**
 * 价格核对逻辑：比对实核单价与基准价 (默认优先按优惠价，若优惠价为0则按单价，也可按单价2核对)
 */
export function checkPriceDiscrepancy(
  item: Pick<PurchaseItem, 'unitPrice' | 'discountPrice' | 'unitPrice2' | 'actualBilledPrice'>,
  basis: 'discountPrice' | 'unitPrice' | 'unitPrice2' = 'discountPrice'
): PriceCheckResult {
  let benchmark = item[basis];
  // 如果选用优惠价但优惠价为0或未设置，则退回到单价
  if (basis === 'discountPrice' && (benchmark === 0 || isNaN(benchmark))) {
    benchmark = item.unitPrice;
  }

  const actual = item.actualBilledPrice;

  if (actual === undefined || isNaN(actual) || actual < 0) {
    return {
      status: 'unconfirmed',
      diff: 0,
      diffPercent: 0,
      benchmarkPrice: benchmark,
    };
  }

  const diff = Number((actual - benchmark).toFixed(2));
  const diffPercent = benchmark > 0 ? Number(((diff / benchmark) * 100).toFixed(1)) : 0;

  // 浮点数安全比较，允许 0.005 内的微小浮点误差
  if (Math.abs(diff) < 0.009) {
    return {
      status: 'matched',
      diff: 0,
      diffPercent: 0,
      benchmarkPrice: benchmark,
    };
  }

  return {
    status: 'discrepancy',
    diff,
    diffPercent,
    benchmarkPrice: benchmark,
  };
}

/**
 * 计算整单的核心统计指标
 */
export function calculateOrderMetrics(
  items: PurchaseItem[],
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2' = 'discountPrice'
): OrderMetrics {
  const totalItems = items.length;
  if (totalItems === 0) {
    return {
      totalItems: 0,
      matchedItems: 0,
      partialItems: 0,
      pendingItems: 0,
      excessItems: 0,
      totalExpectedQty: 0,
      totalReceivedQty: 0,
      totalDamagedQty: 0,
      qtyDifference: 0,
      totalExpectedAmount: 0,
      totalActualAmount: 0,
      amountDifference: 0,
      priceDiscrepancyCount: 0,
      progressPercent: 0,
    };
  }

  let matchedItems = 0;
  let partialItems = 0;
  let pendingItems = 0;
  let excessItems = 0;
  let totalExpectedQty = 0;
  let totalReceivedQty = 0;
  let totalDamagedQty = 0;
  let totalExpectedAmount = 0;
  let totalActualAmount = 0;
  let priceDiscrepancyCount = 0;

  for (const item of items) {
    const status = calculateItemStatus(item.expectedQty, item.receivedQty);
    if (status === 'matched') matchedItems++;
    else if (status === 'partial') partialItems++;
    else if (status === 'pending') pendingItems++;
    else if (status === 'excess') excessItems++;

    totalExpectedQty += item.expectedQty;
    totalReceivedQty += item.receivedQty;
    totalDamagedQty += item.damagedQty || 0;

    // 预期单价
    let expectedPrice = item[priceBasis];
    if (priceBasis === 'discountPrice' && (expectedPrice === 0 || isNaN(expectedPrice))) {
      expectedPrice = item.unitPrice;
    }
    totalExpectedAmount += item.expectedQty * expectedPrice;

    // 实际实核金额
    const actualPrice = item.actualBilledPrice > 0 ? item.actualBilledPrice : expectedPrice;
    totalActualAmount += item.receivedQty * actualPrice;

    const priceCheck = checkPriceDiscrepancy(item, priceBasis);
    if (priceCheck.status === 'discrepancy') {
      priceDiscrepancyCount++;
    }
  }

  const qtyDifference = totalReceivedQty - totalExpectedQty;
  const amountDifference = Number((totalActualAmount - totalExpectedAmount).toFixed(2));
  
  // 总体进度：以品类核对完成率与数量核对率加权
  const itemProgress = matchedItems / totalItems;
  const qtyProgress = totalExpectedQty > 0 ? Math.min(1, totalReceivedQty / totalExpectedQty) : 0;
  const progressPercent = Math.round(((itemProgress + qtyProgress) / 2) * 100);

  return {
    totalItems,
    matchedItems,
    partialItems,
    pendingItems,
    excessItems,
    totalExpectedQty,
    totalReceivedQty,
    totalDamagedQty,
    qtyDifference,
    totalExpectedAmount: Number(totalExpectedAmount.toFixed(2)),
    totalActualAmount: Number(totalActualAmount.toFixed(2)),
    amountDifference,
    priceDiscrepancyCount,
    progressPercent,
  };
}

/**
 * 清理数值字符串，剥离货币符号与千分符
 */
export function cleanNumber(val: string | number | undefined | null): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = val.toString().replace(/[¥$€,，\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 解析用户从Excel或CSV复制粘贴的表格数据
 * 模板顺序：序号 品名 中文 单价 优惠价 条码 数量 货号 单价2 供应商
 */
export function parseImportText(rawText: string): PurchaseItem[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.trim().split(/\r?\n/);
  const result: PurchaseItem[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;

    // 判断是Tab分隔 (TSV/Excel复制) 还是 逗号分隔 (CSV)
    let cols: string[] = [];
    if (line.includes('\t')) {
      cols = line.split('\t').map(c => c.trim());
    } else if (line.includes(',')) {
      cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    } else {
      // 多个空格分隔
      cols = line.split(/\s{2,}/).map(c => c.trim());
    }

    // 过滤标题行 (如果第一行包含'序号'或'品名')
    if (idx === 0 && (cols[0]?.includes('序号') || cols[1]?.includes('品名') || cols.includes('条码'))) {
      continue;
    }

    if (cols.length < 2) continue;

    // 对应模板：0:序号 1:品名 2:中文 3:单价 4:优惠价 5:条码 6:数量 7:货号 8:单价2 9:供应商
    const seq = parseInt(cols[0], 10) || (result.length + 1);
    const name = cols[1] || `商品-${seq}`;
    const chineseName = cols[2] || '';
    const unitPrice = cleanNumber(cols[3]);
    const discountPrice = cleanNumber(cols[4]);
    const barcode = (cols[5] || '').replace(/['"]/g, '').trim();
    const expectedQty = Math.max(0, parseInt(cols[6], 10) || cleanNumber(cols[6]) || 0);
    const itemNo = (cols[7] || '').trim();
    const unitPrice2 = cleanNumber(cols[8]);
    const supplier = (cols[9] || '').trim();

    // 默认实核单价等于优惠价(若有效)或单价
    const defaultActualPrice = discountPrice > 0 ? discountPrice : unitPrice;

    result.push({
      id: `item-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      seq,
      name,
      chineseName,
      unitPrice,
      discountPrice,
      barcode,
      expectedQty,
      itemNo,
      unitPrice2,
      supplier,
      receivedQty: 0,
      damagedQty: 0,
      actualBilledPrice: defaultActualPrice,
      notes: '',
    });
  }

  return result;
}

/**
 * 导出核验报告为兼容Excel的CSV (带UTF-8 BOM)
 */
export function exportToCsv(items: PurchaseItem[], batchTitle: string): string {
  const headers = [
    '序号',
    '品名',
    '中文',
    '单价',
    '优惠价',
    '条码',
    '应收数量',
    '实收数量',
    '破损数量',
    '数量差异',
    '货号',
    '单价2',
    '实核单价',
    '价格差异',
    '到货状态',
    '供应商',
    '备注'
  ];

  const rows = items.map(item => {
    const status = calculateItemStatus(item.expectedQty, item.receivedQty);
    const statusText = {
      pending: '未到货',
      partial: '部分到货',
      matched: '完全齐套',
      excess: '超量到货',
    }[status];

    const qtyDiff = item.receivedQty - item.expectedQty;
    const priceCheck = checkPriceDiscrepancy(item, 'discountPrice');
    const priceDiffText = priceCheck.diff !== 0 ? (priceCheck.diff > 0 ? `+${priceCheck.diff}` : `${priceCheck.diff}`) : '0';

    return [
      item.seq,
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${(item.chineseName || '').replace(/"/g, '""')}"`,
      item.unitPrice.toFixed(2),
      item.discountPrice.toFixed(2),
      `"\t${item.barcode}"`, // 防止Excel科学计数法截断条码
      item.expectedQty,
      item.receivedQty,
      item.damagedQty,
      qtyDiff,
      `"\t${item.itemNo}"`,
      item.unitPrice2.toFixed(2),
      item.actualBilledPrice.toFixed(2),
      priceDiffText,
      statusText,
      `"${(item.supplier || '').replace(/"/g, '""')}"`,
      `"${(item.notes || '').replace(/"/g, '""')}"`
    ].join(',');
  });

  // UTF-8 BOM
  return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

/**
 * 导出核验报告为真正的 Excel .xlsx 格式文件
 */
export function exportToXlsx(items: PurchaseItem[], batchTitle: string): Blob {
  const headers = [
    '序号',
    '品名',
    '中文',
    '单价',
    '优惠价',
    '条码',
    '应收数量',
    '实收数量',
    '破损数量',
    '数量差异',
    '货号',
    '单价2',
    '实核单价',
    '价格差异',
    '到货状态',
    '供应商',
    '备注'
  ];

  const data = items.map(item => {
    const status = calculateItemStatus(item.expectedQty, item.receivedQty);
    const statusText = {
      pending: '未到货',
      partial: '部分到货',
      matched: '完全齐套',
      excess: '超量到货',
    }[status];

    const qtyDiff = item.receivedQty - item.expectedQty;
    const priceCheck = checkPriceDiscrepancy(item, 'discountPrice');
    const priceDiff = priceCheck.diff !== 0 ? priceCheck.diff : 0;

    return [
      item.seq,
      item.name || '',
      item.chineseName || '',
      item.unitPrice,
      item.discountPrice,
      String(item.barcode || ''),
      item.expectedQty,
      item.receivedQty,
      item.damagedQty || 0,
      qtyDiff,
      String(item.itemNo || ''),
      item.unitPrice2,
      item.actualBilledPrice,
      priceDiff,
      statusText,
      item.supplier || '',
      item.notes || ''
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set explicit string type for barcode (col F, index 5) and itemNo (col K, index 10)
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = 1; R <= range.e.r; ++R) {
    const barcodeCellRef = XLSX.utils.encode_cell({ r: R, c: 5 });
    if (ws[barcodeCellRef]) {
      ws[barcodeCellRef].t = 's';
      ws[barcodeCellRef].z = '@';
    }
    const itemNoCellRef = XLSX.utils.encode_cell({ r: R, c: 10 });
    if (ws[itemNoCellRef]) {
      ws[itemNoCellRef].t = 's';
      ws[itemNoCellRef].z = '@';
    }
  }

  // Set comfortable column widths
  ws['!cols'] = [
    { wch: 6 },  // 序号
    { wch: 32 }, // 品名
    { wch: 22 }, // 中文
    { wch: 10 }, // 单价
    { wch: 10 }, // 优惠价
    { wch: 18 }, // 条码
    { wch: 10 }, // 应收数量
    { wch: 10 }, // 实收数量
    { wch: 10 }, // 破损数量
    { wch: 10 }, // 数量差异
    { wch: 16 }, // 货号
    { wch: 10 }, // 单价2
    { wch: 10 }, // 实核单价
    { wch: 10 }, // 价格差异
    { wch: 12 }, // 到货状态
    { wch: 18 }, // 供应商
    { wch: 25 }, // 备注
  ];

  const wb = XLSX.utils.book_new();
  const safeSheetName = (batchTitle || '进货验货核对明细').slice(0, 31).replace(/[\\/?*[\]]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * 模板 1：导出用于直接导入 POS 系统的标准数据文件
 * 模板与导入规范保持严格一致（标准10列），“数量”一栏填入实收数量（receivedQty）
 * 包含所有商品（含实收为0的行）
 */
export function exportToPosImportXlsx(items: PurchaseItem[], batchTitle: string): Blob {
  const headers = [
    '序号',
    '品名',
    '中文',
    '单价',
    '优惠价',
    '条码',
    '数量', // POS导入模板固定识别“数量”，填入实收件数
    '货号',
    '单价2',
    '供应商'
  ];

  const data = items.map(item => [
    item.seq,
    item.name || '',
    item.chineseName || '',
    item.unitPrice,
    item.discountPrice,
    String(item.barcode || ''),
    item.receivedQty, // 数量那一栏写实到数量
    String(item.itemNo || ''),
    item.unitPrice2,
    item.supplier || ''
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set explicit string type for barcode (col F, index 5) and itemNo (col H, index 7) to prevent truncation
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = 1; R <= range.e.r; ++R) {
    const barcodeCellRef = XLSX.utils.encode_cell({ r: R, c: 5 });
    if (ws[barcodeCellRef]) {
      ws[barcodeCellRef].t = 's';
      ws[barcodeCellRef].z = '@';
    }
    const itemNoCellRef = XLSX.utils.encode_cell({ r: R, c: 7 });
    if (ws[itemNoCellRef]) {
      ws[itemNoCellRef].t = 's';
      ws[itemNoCellRef].z = '@';
    }
  }

  // Set standard column widths
  ws['!cols'] = [
    { wch: 6 },  // 序号
    { wch: 32 }, // 品名
    { wch: 22 }, // 中文
    { wch: 10 }, // 单价
    { wch: 10 }, // 优惠价
    { wch: 18 }, // 条码
    { wch: 12 }, // 数量 (实收)
    { wch: 16 }, // 货号
    { wch: 10 }, // 单价2
    { wch: 18 }, // 供应商
  ];

  const wb = XLSX.utils.book_new();
  const safeSheetName = (batchTitle || 'POS导入表').slice(0, 31).replace(/[\\/?*[\]]/g, '_');
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

  const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * 模板 2：别名指向完整17列差异核对结果表
 */
export const exportToAuditResultXlsx = exportToXlsx;

/**
 * 预设高真实度进货单示例数据 (严格遵守10列格式)
 */
export function getSamplePurchaseItems(): PurchaseItem[] {
  const rawSample = [
    {
      seq: 1,
      name: "SK-II Facial Treatment Essence 230ml",
      chineseName: "神仙水精华液 230ml",
      unitPrice: 1540.00,
      discountPrice: 1180.00,
      barcode: "4979004070008",
      expectedQty: 24,
      itemNo: "SKI-FTE-230",
      unitPrice2: 1150.00,
      supplier: "日韩美妆直供社",
      receivedQty: 24,
      damagedQty: 0,
      actualBilledPrice: 1180.00,
      notes: "已清点入库，外盒封条完好",
    },
    {
      seq: 2,
      name: "Estee Lauder ANR Synchronized Multi-Recovery 50ml",
      chineseName: "小棕瓶特润修护精华 50ml",
      unitPrice: 890.00,
      discountPrice: 620.00,
      barcode: "0887167485488",
      expectedQty: 50,
      itemNo: "EL-ANR-50ML",
      unitPrice2: 610.00,
      supplier: "亚太免税供应链",
      receivedQty: 48,
      damagedQty: 2,
      actualBilledPrice: 620.00,
      notes: "实到50件，其中2件外包装挤压变形破损，已拍照留存",
    },
    {
      seq: 3,
      name: "Lancome Advanced Genifique Youth Activating 100ml",
      chineseName: "兰蔻小黑瓶肌底精华 100ml",
      unitPrice: 1480.00,
      discountPrice: 1050.00,
      barcode: "3614272623507",
      expectedQty: 30,
      itemNo: "LAN-GEN-100",
      unitPrice2: 1020.00,
      supplier: "亚太免税供应链",
      receivedQty: 35,
      damagedQty: 0,
      actualBilledPrice: 1080.00,
      notes: "多送5件，且发票结算价1080元比约定优惠价1050元贵30元，需财务核对",
    },
    {
      seq: 4,
      name: "Shiseido Ultimune Power Infusing Concentrate 75ml",
      chineseName: "资生堂红妍肌活红腰子 75ml",
      unitPrice: 1040.00,
      discountPrice: 730.00,
      barcode: "768614144403",
      expectedQty: 40,
      itemNo: "SHI-RED-75",
      unitPrice2: 720.00,
      supplier: "日韩美妆直供社",
      receivedQty: 40,
      damagedQty: 0,
      actualBilledPrice: 730.00,
      notes: "批号新，效期至2028年",
    },
    {
      seq: 5,
      name: "Kiehl's Calendula Herbal-Extract Toner 500ml",
      chineseName: "科颜氏金盏花爽肤水 500ml",
      unitPrice: 560.00,
      discountPrice: 385.00,
      barcode: "3605970379730",
      expectedQty: 60,
      itemNo: "KHL-CAL-500",
      unitPrice2: 375.00,
      supplier: "欧美国际美妆仓",
      receivedQty: 30,
      damagedQty: 0,
      actualBilledPrice: 385.00,
      notes: "仅到货半箱（30瓶），物流反馈余下30瓶分单明日送达",
    },
    {
      seq: 6,
      name: "CPB Cle de Peau Refining Pressed Powder 5g",
      chineseName: "CPB肌肤之钥光透白粉饼 5g",
      unitPrice: 800.00,
      discountPrice: 590.00,
      barcode: "4514254031666",
      expectedQty: 20,
      itemNo: "CPB-POW-05",
      unitPrice2: 580.00,
      supplier: "日韩美妆直供社",
      receivedQty: 0,
      damagedQty: 0,
      actualBilledPrice: 590.00,
      notes: "供应商通知断货延迟发货",
    },
    {
      seq: 7,
      name: "La Mer The Moisturizing Soft Cream 60ml",
      chineseName: "海蓝之谜精华乳霜 60ml",
      unitPrice: 3080.00,
      discountPrice: 2260.00,
      barcode: "747930033371",
      expectedQty: 10,
      itemNo: "LAM-SFT-60",
      unitPrice2: 2200.00,
      supplier: "欧美国际美妆仓",
      receivedQty: 10,
      damagedQty: 0,
      actualBilledPrice: 2260.00,
      notes: "高货值商品，已进防盗保险柜",
    },
    {
      seq: 8,
      name: "Decorte Prime Latte Essential Softening Milk 300ml",
      chineseName: "黛珂牛油果乳液 300ml",
      unitPrice: 480.00,
      discountPrice: 320.00,
      barcode: "4971710368888",
      expectedQty: 36,
      itemNo: "DEC-AVO-300",
      unitPrice2: 310.00,
      supplier: "日韩美妆直供社",
      receivedQty: 36,
      damagedQty: 0,
      actualBilledPrice: 320.00,
      notes: "清点完毕，数量规格一致",
    }
  ];

  return rawSample.map(item => ({
    ...item,
    id: `sample-item-${item.seq}`,
  }));
}

/**
 * 检查对货单是否已经全数完成 (非空且全部商品实收数量 >= 应收数量)
 */
export function isOrderCompleted(order: PurchaseOrder): boolean {
  if (!order.items || order.items.length === 0) return false;
  return order.items.every((it) => it.receivedQty >= it.expectedQty);
}

/**
 * 货单排序算法 (严格按照需求：未完成在上面，完成在下面，完成时间早的在先，完成时间晚的在后)
 */
export function sortPurchaseOrders(orders: PurchaseOrder[]): PurchaseOrder[] {
  return [...orders].sort((a, b) => {
    const aDone = isOrderCompleted(a);
    const bDone = isOrderCompleted(b);

    // 未完成的排在上面，已完成排在下面
    if (!aDone && bDone) return -1;
    if (aDone && !bDone) return 1;

    // 两者都已完成：按完成时间排序 (完成时间早 -> 完成时间晚)
    if (aDone && bDone) {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      return a.title.localeCompare(b.title);
    }

    // 两者都未完成：优先保留活跃/创建顺序
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

/**
 * 预设多张对货单示例数据 (供多个对货单同时核对与排序展示)
 */
export function getSamplePurchaseOrders(): PurchaseOrder[] {
  const sampleItems = getSamplePurchaseItems();

  // 未完成货单 1 (亚太免税采购单 - 其中有部分到货和超收)
  const order1Items: PurchaseItem[] = sampleItems.slice(0, 4).map((it) => ({
    ...it,
    orderId: 'order-1',
    orderTitle: '亚太免税采购单',
  }));

  // 未完成货单 2 (日韩直供现货单 - 其中有未到货和部分到货)
  const order2Items: PurchaseItem[] = sampleItems.slice(4).map((it, idx) => ({
    ...it,
    seq: idx + 1,
    id: `order2-item-${it.seq}`,
    orderId: 'order-2',
    orderTitle: '日韩直供现货单',
  }));

  // 已完成货单 1 (欧美直发补货单 - 早完成: 2026-11-09 08:30:00)
  const order3Items: PurchaseItem[] = [
    {
      id: 'order3-item-1',
      seq: 1,
      name: "La Mer The Treatment Lotion 150ml",
      chineseName: "海蓝之谜修护精萃水 150ml",
      unitPrice: 1250.00,
      discountPrice: 880.00,
      barcode: "747930036686",
      expectedQty: 20,
      receivedQty: 20,
      damagedQty: 0,
      itemNo: "LAM-LOT-150",
      unitPrice2: 860.00,
      actualBilledPrice: 880.00,
      supplier: "欧美国际美妆仓",
      notes: "已全套验收，外包装完好",
      orderId: 'order-3',
      orderTitle: '欧美直发补货单',
    },
    {
      id: 'order3-item-2',
      seq: 2,
      name: "Dior Sauvage Eau De Parfum 100ml",
      chineseName: "迪奥旷野男士浓香水 100ml",
      unitPrice: 1150.00,
      discountPrice: 790.00,
      barcode: "3348901419147",
      expectedQty: 15,
      receivedQty: 15,
      damagedQty: 0,
      itemNo: "CD-SVG-100",
      unitPrice2: 770.00,
      actualBilledPrice: 790.00,
      supplier: "欧美国际美妆仓",
      notes: "现货齐套入库",
      orderId: 'order-3',
      orderTitle: '欧美直发补货单',
    },
  ];

  // 已完成货单 2 (海南自贸保税单 - 晚完成: 2026-11-09 11:45:00)
  const order4Items: PurchaseItem[] = [
    {
      id: 'order4-item-1',
      seq: 1,
      name: "YSL Rouge Pur Couture The Slim 21",
      chineseName: "圣罗兰小金条口红 #21",
      unitPrice: 390.00,
      discountPrice: 245.00,
      barcode: "3614272138612",
      expectedQty: 50,
      receivedQty: 50,
      damagedQty: 0,
      itemNo: "YSL-SLIM-21",
      unitPrice2: 240.00,
      actualBilledPrice: 245.00,
      supplier: "海南保税美妆仓",
      notes: "整箱封条完好，全数入库",
      orderId: 'order-4',
      orderTitle: '海南自贸保税单',
    },
  ];

  return [
    {
      id: 'order-1',
      title: '亚太免税采购单',
      supplier: '亚太免税供应链',
      createdAt: '2026-11-09 08:00',
      isActive: true,
      items: order1Items,
    },
    {
      id: 'order-2',
      title: '日韩直供现货单',
      supplier: '日韩美妆直供社',
      createdAt: '2026-11-09 08:15',
      isActive: true,
      items: order2Items,
    },
    {
      id: 'order-3',
      title: '欧美直发补货单',
      supplier: '欧美国际美妆仓',
      createdAt: '2026-11-09 07:30',
      completedAt: '2026-11-09 08:30:00',
      isActive: false,
      items: order3Items,
    },
    {
      id: 'order-4',
      title: '海南自贸保税单',
      supplier: '海南保税美妆仓',
      createdAt: '2026-11-09 09:00',
      completedAt: '2026-11-09 11:45:00',
      isActive: false,
      items: order4Items,
    },
  ];
}

