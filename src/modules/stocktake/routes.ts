import { Router } from 'express';
import { asyncHandler, sendSuccess } from '../../core/http/envelope';
import { StocktakeService } from './service';

export function createStocktakeRouter(service: StocktakeService): Router {
  const router = Router();

  // 1. POST /api/stocktakes
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const created = await service.createStocktake(req.body?.name, 'system');
      sendSuccess(res, created, 201);
    })
  );

  // 2. GET /api/stocktakes
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const result = await service.listStocktakes();
      sendSuccess(res, result);
    })
  );

  // Export stocktake XLSX
  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const { buffer, filename } = await service.exportStocktakeXlsx(req.params.id);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    })
  );

  // 3. GET /api/stocktakes/:id
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const detail = await service.getStocktakeDetail(req.params.id);
      sendSuccess(res, detail);
    })
  );

  // 4. POST /api/stocktakes/:id/lines
  router.post(
    '/:id/lines',
    asyncHandler(async (req, res) => {
      const line = await service.upsertLine(req.params.id, req.body || {});
      sendSuccess(res, line);
    })
  );

  // 5. POST /api/stocktakes/:id/submit
  router.post(
    '/:id/submit',
    asyncHandler(async (req, res) => {
      const updated = await service.submitStocktake(req.params.id);
      sendSuccess(res, updated);
    })
  );

  // 6. DELETE /api/stocktakes/:id
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const result = await service.deleteStocktake(req.params.id, 'system');
      sendSuccess(res, result);
    })
  );

  return router;
}
