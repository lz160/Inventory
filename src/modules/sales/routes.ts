import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../core/http/envelope';
import { SalesService } from './service';

export function createSalesRouter(service: SalesService): Router {
  const router = Router();

  router.get(
    '/categories',
    asyncHandler(async (_req, res) => {
      sendSuccess(res, service.listCategories());
    })
  );

  router.get(
    '/export',
    asyncHandler(async (req, res) => {
      const buf = await service.exportSalesXlsx({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
      });
      const filename = encodeURIComponent(`sales_analytics_${new Date().toISOString().slice(0, 10)}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
    })
  );

  // 1. GET /api/sales/summary
  router.get(
    '/summary',
    asyncHandler(async (req, res) => {
      const result = await service.getSummary({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
      });
      sendSuccess(res, result);
    })
  );

  // 2. GET /api/sales/timeseries
  router.get(
    '/timeseries',
    asyncHandler(async (req, res) => {
      const result = await service.getTimeseries({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        granularity: req.query.granularity ? String(req.query.granularity) : 'day',
      });
      sendSuccess(res, result);
    })
  );

  // 3. GET /api/sales/top
  router.get(
    '/top',
    asyncHandler(async (req, res) => {
      const result = await service.getTop({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        limit: req.query.limit,
      });
      sendSuccess(res, result);
    })
  );

  // 4. GET /api/sales/slow
  router.get(
    '/slow',
    asyncHandler(async (req, res) => {
      const result = await service.getSlow({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        limit: req.query.limit,
      });
      sendSuccess(res, result);
    })
  );

  // 5. GET /api/sales/margin
  router.get(
    '/margin',
    asyncHandler(async (req, res) => {
      const result = await service.getMargin({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        limit: req.query.limit ?? 50,
      });
      sendSuccess(res, result);
    })
  );

  // 6. GET /api/sales/restock
  router.get(
    '/restock',
    asyncHandler(async (req, res) => {
      const result = await service.getRestock({
        days: req.query.days,
        limit: req.query.limit ?? 50,
      });
      sendSuccess(res, result);
    })
  );

  // 7. GET /api/sales/by-category
  router.get(
    '/by-category',
    asyncHandler(async (req, res) => {
      const result = await service.getByCategory({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
      });
      sendSuccess(res, result);
    })
  );

  // 8. GET /api/sales/uncategorized
  router.get(
    '/uncategorized',
    asyncHandler(async (req, res) => {
      const result = await service.getUncategorized({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        barcode: req.query.barcode ? String(req.query.barcode) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        limit: req.query.limit ?? 100,
      });
      sendSuccess(res, result);
    })
  );

  // 9. POST /api/sales/auto-categorize
  router.post(
    '/auto-categorize',
    asyncHandler(async (req, res) => {
      const result = service.autoCategorize(req.body?.items, 'system');
      sendSuccess(res, result);
    })
  );

  return router;
}
