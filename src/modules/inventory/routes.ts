import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../core/http/envelope';
import { InventoryService } from './service';
import { InventoryImportMode, StockStatus } from './types';

export function createInventoryRouter(service: InventoryService): Router {
  const router = Router();

  // 1. GET /api/g1/products
  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const stockVal = String(req.query.stock || '').trim();
      const stock = ['in', 'low', 'out'].includes(stockVal) ? (stockVal as StockStatus) : undefined;
      const result = await service.listProducts({
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        kod: req.query.kod ? String(req.query.kod) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        supplier: req.query.supplier ? String(req.query.supplier) : undefined,
        stock,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
        sortDir: req.query.sortDir ? String(req.query.sortDir) : undefined,
      });
      sendSuccess(res, result);
    })
  );

  // Export inventory XLSX
  router.get(
    '/export',
    asyncHandler(async (req, res) => {
      const stockVal = String(req.query.stock || '').trim();
      const stock = ['in', 'low', 'out'].includes(stockVal) ? (stockVal as StockStatus) : undefined;
      const buf = await service.exportProductsXlsx({
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        kod: req.query.kod ? String(req.query.kod) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        supplier: req.query.supplier ? String(req.query.supplier) : undefined,
        stock,
        sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
        sortDir: req.query.sortDir ? String(req.query.sortDir) : undefined,
      });
      const filename = encodeURIComponent(`inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    })
  );

  // Download standard inventory import XLSX template
  router.get(
    '/import-template',
    asyncHandler(async (_req, res) => {
      const buf = await service.getImportTemplateXlsx();
      const filename = encodeURIComponent('inventory_import_template.xlsx');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    })
  );

  // Batch inventory import (Upsert / Create-only / Update-only)
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const rawMode = String(req.body?.mode || 'upsert');
      const mode: InventoryImportMode =
        rawMode === 'create_only' || rawMode === 'update_only' ? rawMode : 'upsert';
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const result = await service.importProducts(items, mode, 'system');
      sendSuccess(res, result);
    })
  );

  // 2. GET /api/g1/products/:barcode
  router.get(
    '/products/:barcode',
    asyncHandler(async (req, res) => {
      const product = await service.getProduct(req.params.barcode);
      sendSuccess(res, product);
    })
  );

  // 3. POST /api/g1/products
  router.post(
    '/products',
    asyncHandler(async (req, res) => {
      const created = await service.createProduct(req.body || {}, 'system');
      sendSuccess(res, created, 201);
    })
  );

  // 4. PATCH /api/g1/products/:barcode
  router.patch(
    '/products/:barcode',
    asyncHandler(async (req, res) => {
      const updated = await service.updateProduct(req.params.barcode, req.body || {}, 'system');
      sendSuccess(res, updated);
    })
  );

  // Optional separate async category assignment from product edit modal (§4.5 item 4)
  router.patch(
    '/products/:barcode/category',
    asyncHandler(async (req, res) => {
      const category = req.body?.category ? String(req.body.category) : null;
      const changedBy = (req as any).userSession?.user.username ?? 'system';
      const meta = await service.updateProductCategory(req.params.barcode, category, changedBy, req.body?.name_zh);
      sendSuccess(res, meta);
    })
  );

  // 5. DELETE /api/g1/products/:barcode
  router.delete(
    '/products/:barcode',
    asyncHandler(async (req, res) => {
      const result = await service.deleteProduct(req.params.barcode);
      sendSuccess(res, result);
    })
  );

  // 6. GET /api/g1/suppliers
  router.get(
    '/suppliers',
    asyncHandler(async (_req, res) => {
      const suppliers = await service.listSuppliers();
      sendSuccess(res, suppliers);
    })
  );

  // 7. GET /api/g1/low-stock
  router.get(
    '/low-stock',
    asyncHandler(async (_req, res) => {
      const result = await service.listLowStock();
      sendSuccess(res, result);
    })
  );

  router.get(
    '/categories',
    asyncHandler(async (_req, res) => {
      sendSuccess(res, await service.listCategories());
    })
  );

  return router;
}
