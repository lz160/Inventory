import { Router } from 'express';
import { getHostedStorePool } from '../../core/db/hostedSql';
import { AppError, asyncHandler, conflictError, sendSuccess, serverError } from '../../core/http/envelope';
import type { StoreSessionInfo } from '../../core/db/metaStore';
import { changeReceivingLine, deleteReceivingOrder, importReceivingOrder, listReceivingOrders } from './repository';
import { receivingId, receivingVersion, validateReceivingImport, validateReceivingLineChange } from './validation';

export function createReceivingRouter() {
  const router = Router();

  router.use(asyncHandler(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const store = (req as typeof req & { storeSession?: StoreSessionInfo }).storeSession;
    if (!store || req.get('X-Store-Id') !== String(store.storeId)) {
      throw conflictError('当前门店已切换，请刷新进货单后重试');
    }
    res.locals.receivingPool = await getHostedStorePool(store.storeId);
    next();
  }));

  router.get('/orders', asyncHandler(async (_req, res) =>
    sendSuccess(res, await listReceivingOrders(res.locals.receivingPool))
  ));

  router.post('/orders/import', asyncHandler(async (req, res) =>
    sendSuccess(res, await importReceivingOrder(res.locals.receivingPool, validateReceivingImport(req.body)), 201)
  ));

  router.delete('/orders/:id', asyncHandler(async (req, res) => {
    await deleteReceivingOrder(res.locals.receivingPool, receivingId(req.params.id), receivingVersion(req.body?.version));
    return sendSuccess(res, null);
  }));

  router.patch('/lines/:id', asyncHandler(async (req, res) =>
    sendSuccess(res, await changeReceivingLine(
      res.locals.receivingPool, receivingId(req.params.id), validateReceivingLineChange(req.body)
    ))
  ));

  router.use(((err, _req, _res, next) => {
    if (err instanceof AppError) return next(err);
    console.error('Receiving database operation failed:', err?.code ?? 'UNKNOWN', err?.number ?? '');
    return next(serverError('暂时无法访问进货单数据库，请稍后重试'));
  }) as import('express').ErrorRequestHandler);

  return router;
}
