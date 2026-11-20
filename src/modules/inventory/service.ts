import { MetaStore } from '../../core/db/metaStore';
import { notFoundError, validationError } from '../../core/http/envelope';
import { InventoryRepository } from './repository';
import {
  G1Product,
  InventoryImportItemInput,
  InventoryImportMode,
  InventoryImportResult,
  ProductListQuery,
} from './types';
import {
  buildInventoryExportWorkbookBytes,
  buildInventoryImportTemplateBytes,
  resolveCategoryCode,
} from './excelTemplate';
import {
  clampPagination,
  filterEditablePatch,
  normalizeBarcode,
  validateCreateProductPayload,
} from './validators';

export class InventoryService {
  constructor(private repo: InventoryRepository, private metaStore: MetaStore) {}

  private enrichCategoryMeta(products: G1Product[]): G1Product[] {
    const metaMap = this.metaStore.getAllProductMetaMap();
    const catMap = new Map(this.metaStore.listCategories().map((c) => [c.code, c]));
    return products.map((p) => {
      const meta = metaMap.get(p.Barcode.trim());
      const cat = meta?.category ? catMap.get(meta.category) : undefined;
      return {
        ...p,
        category: meta?.category ?? null,
        category_name_sk: cat?.name_sk ?? null,
        category_name_zh: cat?.name_zh ?? null,
      };
    });
  }

  // R-INV-1
  async listProducts(query: ProductListQuery) {
    const { page, pageSize } = clampPagination(query.page, query.pageSize);
    const res = await this.repo.listProducts(query, page, pageSize);
    return {
      rows: this.enrichCategoryMeta(res.rows),
      total: res.total,
      page,
      pageSize,
    };
  }

  // R-INV-2
  async getProduct(barcodeRaw: string): Promise<G1Product> {
    const bc = normalizeBarcode(barcodeRaw);
    const product = await this.repo.getProductByBarcode(bc);
    if (!product) {
      throw notFoundError(`条码 ${bc} 的商品不存在`);
    }
    const [enriched] = this.enrichCategoryMeta([product]);
    return enriched;
  }

  // R-INV-3
  async createProduct(body: Record<string, any>, changedBy: string): Promise<G1Product> {
    const payload = validateCreateProductPayload(body);
    const created = await this.repo.createProduct(payload, changedBy);
    if (body.category !== undefined) {
      try {
        this.metaStore.upsertProductMeta(
          created.Barcode,
          body.category ? String(body.category) : null,
          null,
          changedBy
        );
      } catch (err) {
        console.warn('[Inventory] Optional category save failed on create:', err);
      }
    }
    const [enriched] = this.enrichCategoryMeta([created]);
    return enriched;
  }

  // R-INV-4
  async updateProduct(barcodeRaw: string, body: Record<string, any>, changedBy: string): Promise<G1Product> {
    const bc = normalizeBarcode(barcodeRaw);
    const patch = filterEditablePatch(body);
    const { after } = await this.repo.updateProduct(bc, patch, changedBy);
    const [enriched] = this.enrichCategoryMeta([after]);
    return enriched;
  }

  // Async metadata / category update per §4.5 item 4
  updateProductCategory(barcodeRaw: string, category: string | null, changedBy: string) {
    const bc = normalizeBarcode(barcodeRaw);
    return this.metaStore.upsertProductMeta(bc, category || null, null, changedBy);
  }

  // R-INV-6
  async deleteProduct(barcodeRaw: string): Promise<{ deleted: true }> {
    const bc = normalizeBarcode(barcodeRaw);
    const deleted = await this.repo.deleteProduct(bc);
    if (!deleted) {
      throw notFoundError(`条码 ${bc} 的商品不存在`);
    }
    try {
      this.metaStore.deleteProductMeta(bc);
    } catch {
      // non-blocking metadata cleanup
    }
    return { deleted: true };
  }


  // R-INV-7
  async listSuppliers(): Promise<string[]> {
    return this.repo.listSuppliers();
  }

  // R-INV-8
  async listLowStock() {
    const res = await this.repo.listLowStock();
    const enriched = this.enrichCategoryMeta(res.rows) as Array<G1Product & { Gap: number }>;
    return {
      rows: enriched,
      total: res.total,
    };
  }

  // Synchronized Inventory XLSX Export
  async exportProductsXlsx(query: ProductListQuery): Promise<Buffer> {
    const rawRows = await this.repo.getAllMatchingForExport(query);
    const rows = this.enrichCategoryMeta(rawRows);
    return Buffer.from(buildInventoryExportWorkbookBytes(rows));
  }

  // Standard Inventory Import Template XLSX
  getImportTemplateXlsx(): Buffer {
    return Buffer.from(buildInventoryImportTemplateBytes());
  }

  // Batch Inventory Import (create_only | update_only | upsert) with strict 29-field whitelist
  async importProducts(
    items: InventoryImportItemInput[],
    mode: InventoryImportMode,
    changedBy = 'system'
  ): Promise<InventoryImportResult> {
    if (!Array.isArray(items) || items.length === 0) {
      throw validationError('导入明细列表不能为空');
    }
    if (items.length > 500) {
      throw validationError('单次导入最多支持 500 行商品，请分批导入');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: InventoryImportResult['errors'] = [];

    for (let idx = 0; idx < items.length; idx++) {
      const raw = items[idx] || ({} as InventoryImportItemInput);
      const rowNumber = Number(raw.rowNumber || idx + 2);
      const bcRaw = String(raw.Barcode ?? '').trim();

      try {
        const bc = normalizeBarcode(bcRaw);
        const existing = await this.repo.getProductByBarcode(bc);

        const resolvedCat =
          raw.category !== undefined && raw.category !== null && String(raw.category).trim() !== ''
            ? resolveCategoryCode(raw.category) ?? String(raw.category).trim()
            : undefined;

        if (existing) {
          if (mode === 'create_only') {
            skipped++;
            continue;
          }

          const patchPayload: Record<string, any> = {};
          if (raw.Nazov !== undefined && String(raw.Nazov).trim() !== '') {
            patchPayload.Nazov = String(raw.Nazov).trim();
          }
          if (raw.Kod !== undefined && String(raw.Kod).trim() !== '') {
            patchPayload.Kod = String(raw.Kod).trim();
          }
          if (raw.Supplier !== undefined && String(raw.Supplier).trim() !== '') {
            patchPayload.Supplier = String(raw.Supplier).trim();
          }
          if (raw.Surplus !== undefined && raw.Surplus !== null && String(raw.Surplus) !== '') {
            patchPayload.Surplus = Number(raw.Surplus);
          }
          if (raw.Cena !== undefined && raw.Cena !== null && String(raw.Cena) !== '') {
            const c = Number(raw.Cena);
            if (!Number.isFinite(c) || c < 0) throw validationError('售价 (Cena) 必须为非负数字');
            patchPayload.Cena = c;
          }
          if (raw.Cena2 !== undefined && raw.Cena2 !== null && String(raw.Cena2) !== '') {
            const c2 = Number(raw.Cena2);
            if (!Number.isFinite(c2) || c2 < 0) throw validationError('进货价 (Cena2) 必须为非负数字');
            patchPayload.Cena2 = c2;
          }
          if (raw.barcode2nd !== undefined && String(raw.barcode2nd).trim() !== '') {
            patchPayload.barcode2nd = String(raw.barcode2nd).trim();
          }
          if (
            raw.conv2ndtobarcode !== undefined &&
            raw.conv2ndtobarcode !== null &&
            String(raw.conv2ndtobarcode) !== ''
          ) {
            patchPayload.conv2ndtobarcode = Number(raw.conv2ndtobarcode);
          }

          let didUpdate = false;
          if (Object.keys(patchPayload).length > 0) {
            const filtered = filterEditablePatch(patchPayload);
            await this.repo.updateProduct(bc, filtered, changedBy);
            didUpdate = true;
          }
          if (resolvedCat !== undefined) {
            this.metaStore.upsertProductMeta(bc, resolvedCat, null, changedBy);
            didUpdate = true;
          }

          if (didUpdate) {
            updated++;
          } else {
            skipped++;
          }
        } else {
          if (mode === 'update_only') {
            skipped++;
            continue;
          }

          const payload = validateCreateProductPayload({
            Barcode: bc,
            Nazov: raw.Nazov,
            Kod: raw.Kod,
            Supplier: raw.Supplier,
            Surplus: raw.Surplus,
            Cena: raw.Cena,
            Cena2: raw.Cena2,
            barcode2nd: raw.barcode2nd,
            conv2ndtobarcode: raw.conv2ndtobarcode,
          });
          await this.repo.createProduct(payload, changedBy);
          if (resolvedCat !== undefined) {
            this.metaStore.upsertProductMeta(bc, resolvedCat, null, changedBy);
          }
          created++;
        }
      } catch (err: any) {
        errors.push({
          rowNumber,
          barcode: bcRaw || '-',
          message: err?.message || '导入失败',
        });
      }
    }

    return { created, updated, skipped, errors };
  }
}
