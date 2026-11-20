import * as XLSX from 'xlsx';
import { CATEGORY_DICTIONARY } from '../sales/category-rules';
import { G1Product, InventoryImportItemInput } from './types';
import { calculateVatMetrics, getStockStatus } from './validators';

export const INVENTORY_TEMPLATE_HEADERS = [
  '条码_Barcode',
  '商品名称_Nazov',
  '货号_Kod',
  '供应商_Supplier',
  '品类编码_Category',
  '品类名称_ZH',
  '品类名称_SK',
  '可售库存_Surplus',
  '警戒线_WarningAt',
  '库存状态_Status',
  '售价(含VAT 23%)_Cena',
  '净售价(不含税)_NetPrice',
  '进货价(不含税)_Cena2',
  '净毛利(EUR)_NetMargin',
  '净毛利率(%)_NetMarginRate',
  '第二条码_barcode2nd',
  '箱规换算率_conv2ndtobarcode',
] as const;

export function buildInventoryExportRows(products: G1Product[]) {
  return products.map((p) => {
    const vat = calculateVatMetrics(p.Cena, p.Cena2);
    const status = getStockStatus(p.Surplus, p.WarningAt);
    const statusLabel =
      status === 'out' ? '缺货 (out)' : status === 'low' ? '低库存 (low)' : '有货 (in)';
    return {
      条码_Barcode: p.Barcode,
      商品名称_Nazov: p.Nazov,
      货号_Kod: p.Kod || '',
      供应商_Supplier: p.Supplier || '',
      品类编码_Category: p.category || '',
      品类名称_ZH: p.category_name_zh || '',
      品类名称_SK: p.category_name_sk || '',
      可售库存_Surplus: Number(Number(p.Surplus ?? 0).toFixed(2)),
      警戒线_WarningAt: Number(Number(p.WarningAt ?? 0).toFixed(0)),
      库存状态_Status: statusLabel,
      '售价(含VAT 23%)_Cena': Number(Number(p.Cena ?? 0).toFixed(2)),
      '净售价(不含税)_NetPrice': Number(vat.netPrice.toFixed(2)),
      '进货价(不含税)_Cena2': Number(Number(p.Cena2 ?? 0).toFixed(2)),
      '净毛利(EUR)_NetMargin': Number(vat.netMargin.toFixed(2)),
      '净毛利率(%)_NetMarginRate':
        vat.netMarginRate === null ? '' : Number((vat.netMarginRate * 100).toFixed(1)),
      第二条码_barcode2nd: p.barcode2nd || '',
      箱规换算率_conv2ndtobarcode: Number(Number(p.conv2ndtobarcode ?? 0).toFixed(0)),
    };
  });
}

function applyColumnWidths(ws: XLSX.WorkSheet) {
  ws['!cols'] = [
    { wch: 16 }, // Barcode
    { wch: 30 }, // Nazov
    { wch: 14 }, // Kod
    { wch: 18 }, // Supplier
    { wch: 18 }, // Category code
    { wch: 18 }, // Category ZH
    { wch: 22 }, // Category SK
    { wch: 14 }, // Surplus
    { wch: 14 }, // WarningAt
    { wch: 14 }, // Status
    { wch: 18 }, // Cena
    { wch: 16 }, // NetPrice
    { wch: 18 }, // Cena2
    { wch: 16 }, // NetMargin
    { wch: 18 }, // NetMarginRate
    { wch: 16 }, // barcode2nd
    { wch: 18 }, // conv2ndtobarcode
  ];
}

export function buildInventoryExportWorkbookBytes(products: G1Product[]): Uint8Array {
  const sheetRows = buildInventoryExportRows(products);
  const emptyRow: Record<string, any> = {
    条码_Barcode: '',
    商品名称_Nazov: '',
    货号_Kod: '',
    供应商_Supplier: '',
    品类编码_Category: '',
    品类名称_ZH: '',
    品类名称_SK: '',
    可售库存_Surplus: 0,
    警戒线_WarningAt: 0,
    库存状态_Status: '',
    '售价(含VAT 23%)_Cena': 0,
    '净售价(不含税)_NetPrice': 0,
    '进货价(不含税)_Cena2': 0,
    '净毛利(EUR)_NetMargin': 0,
    '净毛利率(%)_NetMarginRate': '',
    第二条码_barcode2nd: '',
    箱规换算率_conv2ndtobarcode: 0,
  };

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [emptyRow]);
  applyColumnWidths(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function buildInventoryImportTemplateBytes(): Uint8Array {
  const sampleRows = [
    {
      条码_Barcode: '8580000000001',
      商品名称_Nazov: 'Vzorový produkt / 示例商品（可修改或删除此行）',
      货号_Kod: 'SKU-001',
      供应商_Supplier: 'Dodávateľ s.r.o.',
      品类编码_Category: 'food_snack',
      品类名称_ZH: '食品零食',
      品类名称_SK: 'Potraviny a pochutiny',
      可售库存_Surplus: 24,
      警戒线_WarningAt: 5,
      库存状态_Status: '有货 (in)',
      '售价(含VAT 23%)_Cena': 2.46,
      '净售价(不含税)_NetPrice': 2.0,
      '进货价(不含税)_Cena2': 1.2,
      '净毛利(EUR)_NetMargin': 0.8,
      '净毛利率(%)_NetMarginRate': 40.0,
      第二条码_barcode2nd: '',
      箱规换算率_conv2ndtobarcode: 1,
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  applyColumnWidths(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

  const guideRows = [
    {
      字段列名: '条码_Barcode',
      是否必填: '必填 (1-13位)',
      导入行为说明: '商品主条码，唯一标识。存在则按所选模式更新，不存在则按所选模式新建。',
    },
    {
      字段列名: '商品名称_Nazov',
      是否必填: '新建必填',
      导入行为说明: '商品名称（最多510字符）；更新已有商品时若留空则保留原名称。',
    },
    {
      字段列名: '货号_Kod / 供应商_Supplier',
      是否必填: '选填',
      导入行为说明: '填写入库货号与供应商名称，留空时不覆盖已有值。',
    },
    {
      字段列名: '品类编码_Category',
      是否必填: '选填',
      导入行为说明: '可填品类编码（如 food_snack）或中文/斯语品类名称，系统自动匹配归类。',
    },
    {
      字段列名: '可售库存_Surplus',
      是否必填: '选填',
      导入行为说明: '可用库存数量，支持负数及小数。',
    },
    {
      字段列名: '售价(含VAT 23%)_Cena / 进货价(不含税)_Cena2',
      是否必填: '选填',
      导入行为说明: '欧元金额（非负数值）。修改售价/进货价会自动写入 PriceHistory。',
    },
    {
      字段列名: '警戒线_WarningAt / 状态 / 净售价 / 毛利字段',
      是否必填: '只读参考列',
      导入行为说明: '自动计算或由盘点模块管理，导入已有商品时不会覆盖 WarningAt。',
    },
    ...CATEGORY_DICTIONARY.map((cat) => ({
      字段列名: `品类编码: ${cat.code}`,
      是否必填: cat.name_zh,
      导入行为说明: cat.name_sk,
    })),
  ];

  const guideWs = XLSX.utils.json_to_sheet(guideRows);
  guideWs['!cols'] = [{ wch: 36 }, { wch: 24 }, { wch: 62 }];
  XLSX.utils.book_append_sheet(wb, guideWs, 'FieldGuide');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}

const categoryLookup = (() => {
  const byKey = new Map<string, string>();
  for (const c of CATEGORY_DICTIONARY) {
    byKey.set(c.code.toLowerCase(), c.code);
    byKey.set(c.name_zh.trim().toLowerCase(), c.code);
    byKey.set(c.name_sk.trim().toLowerCase(), c.code);
  }
  return byKey;
})();

export function resolveCategoryCode(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  return categoryLookup.get(text.toLowerCase());
}

function normalizeHeaderKey(key: string): string {
  return key.toLowerCase().replace(/[\s_()（）%\-:/]/g, '');
}

function pickColumnValue(row: Record<string, any>, aliases: string[]): unknown {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const normAlias = normalizeHeaderKey(alias);
    for (const [k, v] of entries) {
      if (normalizeHeaderKey(k) === normAlias) {
        return v;
      }
    }
  }
  return undefined;
}

function parseOptionalNumber(raw: unknown): { value?: number; valid: boolean } {
  if (raw === null || raw === undefined) return { valid: true };
  const s = String(raw).trim();
  if (!s) return { valid: true };
  const cleaned = s.replace(/[€,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { valid: false };
  return { value: n, valid: true };
}

export interface ParsedWorkbookRow {
  rowNumber: number;
  item?: InventoryImportItemInput;
  error?: string;
}

export function parseInventoryWorkbook(data: ArrayBuffer | Uint8Array): {
  parsedRows: ParsedWorkbookRow[];
  validItems: InventoryImportItemInput[];
  errorCount: number;
} {
  const wb = XLSX.read(data, { type: data instanceof Uint8Array ? 'array' : 'array' });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === 'inventory') || wb.SheetNames[0];
  if (!sheetName) {
    return { parsedRows: [], validItems: [], errorCount: 0 };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName], {
    defval: '',
  });

  const parsedRows: ParsedWorkbookRow[] = [];
  const validItems: InventoryImportItemInput[] = [];
  let errorCount = 0;

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // 1-based Excel row with header
    const barcodeRaw = pickColumnValue(raw, [
      '条码_Barcode',
      'Barcode',
      '条码',
      'EAN',
      'Čiarový kód',
    ]);
    const barcode = String(barcodeRaw ?? '').trim();
    const nazovRaw = pickColumnValue(raw, [
      '商品名称_Nazov',
      'Nazov',
      '商品名称',
      '品名',
      'Názov produktu',
      'Name',
    ]);
    const nazov = String(nazovRaw ?? '').trim();

    // Skip completely blank trailing rows
    if (!barcode && !nazov) {
      return;
    }

    if (!barcode) {
      errorCount++;
      parsedRows.push({ rowNumber, error: '条码 (Barcode) 不能为空' });
      return;
    }
    if (barcode.length > 13) {
      errorCount++;
      parsedRows.push({ rowNumber, error: `条码 ${barcode} 超过 13 位上限` });
      return;
    }

    const kodRaw = pickColumnValue(raw, ['货号_Kod', 'Kod', '货号', 'SKU']);
    const supplierRaw = pickColumnValue(raw, ['供应商_Supplier', 'Supplier', '供应商', 'Dodávateľ']);
    const catCodeRaw = pickColumnValue(raw, ['品类编码_Category', 'Category', '品类编码', 'Kategória']);
    const catZhRaw = pickColumnValue(raw, ['品类名称_ZH', '品类中文']);
    const catSkRaw = pickColumnValue(raw, ['品类名称_SK', '品类斯语']);
    const surplusRaw = pickColumnValue(raw, ['可售库存_Surplus', 'Surplus', '可用库存', '库存']);
    const cenaRaw = pickColumnValue(raw, ['售价(含VAT 23%)_Cena', 'Cena', '售价', '售价(含23% VAT)']);
    const cena2Raw = pickColumnValue(raw, ['进货价(不含税)_Cena2', 'Cena2', '进货价', '进货价(不含税)']);
    const bc2Raw = pickColumnValue(raw, ['第二条码_barcode2nd', 'barcode2nd', '第二条码']);
    const convRaw = pickColumnValue(raw, ['箱规换算率_conv2ndtobarcode', 'conv2ndtobarcode', '换算率']);

    const surplusParsed = parseOptionalNumber(surplusRaw);
    const cenaParsed = parseOptionalNumber(cenaRaw);
    const cena2Parsed = parseOptionalNumber(cena2Raw);
    const convParsed = parseOptionalNumber(convRaw);

    if (!surplusParsed.valid) {
      errorCount++;
      parsedRows.push({ rowNumber, error: `条码 ${barcode}: 可售库存 (Surplus) 非有效数字` });
      return;
    }
    if (!cenaParsed.valid || (cenaParsed.value !== undefined && cenaParsed.value < 0)) {
      errorCount++;
      parsedRows.push({ rowNumber, error: `条码 ${barcode}: 售价 (Cena) 必须为非负数字` });
      return;
    }
    if (!cena2Parsed.valid || (cena2Parsed.value !== undefined && cena2Parsed.value < 0)) {
      errorCount++;
      parsedRows.push({ rowNumber, error: `条码 ${barcode}: 进货价 (Cena2) 必须为非负数字` });
      return;
    }
    if (!convParsed.valid) {
      errorCount++;
      parsedRows.push({ rowNumber, error: `条码 ${barcode}: 换算率非有效数字` });
      return;
    }

    const resolvedCat =
      resolveCategoryCode(catCodeRaw) ??
      resolveCategoryCode(catZhRaw) ??
      resolveCategoryCode(catSkRaw);

    const item: InventoryImportItemInput = {
      rowNumber,
      Barcode: barcode,
      ...(nazov ? { Nazov: nazov } : {}),
      ...(String(kodRaw ?? '').trim() ? { Kod: String(kodRaw).trim() } : {}),
      ...(String(supplierRaw ?? '').trim() ? { Supplier: String(supplierRaw).trim() } : {}),
      ...(resolvedCat ? { category: resolvedCat } : {}),
      ...(surplusParsed.value !== undefined ? { Surplus: surplusParsed.value } : {}),
      ...(cenaParsed.value !== undefined ? { Cena: cenaParsed.value } : {}),
      ...(cena2Parsed.value !== undefined ? { Cena2: cena2Parsed.value } : {}),
      ...(String(bc2Raw ?? '').trim() ? { barcode2nd: String(bc2Raw).trim() } : {}),
      ...(convParsed.value !== undefined ? { conv2ndtobarcode: convParsed.value } : {}),
    };

    parsedRows.push({ rowNumber, item });
    validItems.push(item);
  });

  return { parsedRows, validItems, errorCount };
}
