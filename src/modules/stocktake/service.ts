import * as XLSX from 'xlsx';
import { notFoundError, validationError } from '../../core/http/envelope';
import { StocktakeRepository } from './repository';
import { StocktakeHead, StocktakeLine } from './types';
import {
  calculateVariance,
  normalizeStocktakeName,
  validateStocktakeLineInput,
} from './validators';

export class StocktakeService {
  constructor(private repo: StocktakeRepository) {}

  async createStocktake(rawName: unknown, createdBy: string) {
    const name = normalizeStocktakeName(rawName);
    const stocktake = await this.repo.createStocktake(name, createdBy);
    return {
      ...stocktake,
      lines: [] as StocktakeLine[],
    };
  }

  async listStocktakes() {
    const rows = await this.repo.listStocktakes();
    return { rows };
  }

  async getStocktakeDetail(idRaw: unknown) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      throw validationError('无效的盘点单 ID');
    }
    const stocktake = await this.repo.getStocktakeById(id);
    if (!stocktake) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    const lines = await this.repo.listLines(id);
    return { stocktake, lines };
  }

  async upsertLine(idRaw: unknown, body: Record<string, any>) {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      throw validationError('无效的盘点单 ID');
    }
    const head = await this.repo.getStocktakeById(id);
    if (!head) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    if (head.Status !== 'open') {
      throw validationError('盘点单已提交，不可再录行');
    }

    const input = validateStocktakeLineInput(body);
    const product = await this.repo.lookupG1Product(input.barcode);
    if (!product) {
      throw notFoundError(`条码 ${input.barcode} 的商品不存在于本店 g1`);
    }

    const systemQty = Number(product.Surplus ?? 0) || 0;
    const variance = calculateVariance(input.countedQty, systemQty);

    return this.repo.upsertLineAndSyncG1({
      stocktakeId: id,
      barcode: input.barcode,
      nazov: product.Nazov,
      systemQty,
      countedQty: input.countedQty,
      variance,
      warningAt: input.warningAt,
      hasWarningAt: input.hasWarningAt,
      notes: input.notes,
    });
  }

  async submitStocktake(idRaw: unknown): Promise<StocktakeHead> {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      throw validationError('无效的盘点单 ID');
    }
    const head = await this.repo.getStocktakeById(id);
    if (!head) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    if (head.Status !== 'open') {
      throw validationError('盘点单已提交');
    }
    const lines = await this.repo.listLines(id);
    if (lines.length === 0) {
      throw validationError('盘点单没有任何行，无法提交');
    }
    return this.repo.submitStocktake(id);
  }

  async deleteStocktake(idRaw: unknown, requestedBy: string): Promise<{ deleted: number }> {
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      throw validationError('无效的盘点单 ID');
    }
    const head = await this.repo.getStocktakeById(id);
    if (!head) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    const ok = await this.repo.deleteStocktake(id);
    if (!ok) {
      throw notFoundError(`盘点单 ${id} 不存在`);
    }
    console.info(`[Audit] Stocktake deleted: id=${id}, name=${head.Name}, status=${head.Status}, by=${requestedBy}`);
    return { deleted: id };
  }

  // Q15 Stocktake Variance XLSX Export
  async exportStocktakeXlsx(idRaw: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const { stocktake, lines } = await this.getStocktakeDetail(idRaw);
    const sheetRows = lines.map((l) => ({
      盘点单名称: stocktake.Name,
      条码_Barcode: l.Barcode,
      商品名称_Nazov: l.Nazov || '',
      系统库存_SystemQty: Number(Number(l.SystemQty ?? 0).toFixed(2)),
      实盘数量_CountedQty: Number(Number(l.CountedQty ?? 0).toFixed(2)),
      盘点差异_Variance: Number(Number(l.Variance ?? 0).toFixed(2)),
      警戒线_WarningAt: l.WarningAt === null || l.WarningAt === undefined ? '' : l.WarningAt,
      备注_Notes: l.Notes || '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      sheetRows.length > 0
        ? sheetRows
        : [
            {
              盘点单名称: stocktake.Name,
              条码_Barcode: '',
              商品名称_Nazov: '',
              系统库存_SystemQty: 0,
              实盘数量_CountedQty: 0,
              盘点差异_Variance: 0,
              警戒线_WarningAt: '',
              备注_Notes: '',
            },
          ]
    );
    XLSX.utils.book_append_sheet(wb, ws, 'StocktakeVariance');
    const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const safeName = stocktake.Name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    return { buffer, filename: `${safeName}_variance.xlsx` };
  }
}
