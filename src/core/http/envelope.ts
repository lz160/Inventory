import { Request, Response, NextFunction } from 'express';

export type ErrorCode = 40100 | 40300 | 40404 | 40901 | 42201 | 50000 | 50101;

export class AppError extends Error {
  public readonly httpStatus: number;
  public readonly code: ErrorCode;

  constructor(httpStatus: number, code: ErrorCode, message: string) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.name = 'AppError';
  }
}

export function ok<T>(res: Response, data: T, httpStatus = 200) {
  return res.status(httpStatus).json({
    code: 0,
    data,
    message: '',
  });
}

export const sendSuccess = ok;

export function fail(res: Response, httpStatus: number, code: ErrorCode, message: string) {
  return res.status(httpStatus).json({
    code,
    message,
  });
}

export function unauthorizedError(message = '未登录或会话已过期，请重新登录门店账号') {
  return new AppError(401, 40100, message);
}

export function forbiddenError(message = '无权执行此操作') {
  return new AppError(403, 40300, message);
}

export function notFound(message = '请求的资源不存在') {
  return new AppError(404, 40404, message);
}

export const notFoundError = notFound;

export function conflict(message = '资源冲突') {
  return new AppError(409, 40901, message);
}

export const conflictError = conflict;

export function validationError(message = '参数校验失败') {
  return new AppError(422, 42201, message);
}

export function serverError(message = '服务器内部错误') {
  return new AppError(500, 50000, message);
}

export function notImplemented(message = '功能尚未实现') {
  return new AppError(501, 50101, message);
}

/**
 * Global request wrapper for async Express handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global API error middleware (§3.3 & §7.6).
 * Never exposes stack traces to the client; logs route, user, code, and duration.
 */
export function apiErrorMiddleware(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const startedAt = (req as any)._startedAt || Date.now();
  const durationMs = Date.now() - startedAt;

  if (err instanceof AppError) {
    console.warn(
      `[API] ${req.method} ${req.originalUrl} status=${err.httpStatus} code=${err.code} duration=${durationMs}ms msg=${err.message}`
    );
    return fail(res, err.httpStatus, err.code, err.message);
  }

  // Handle SQL Server / network / timeout errors cleanly without leaking stack or secrets
  const msg = String(err?.message || '');
  const code = String(err?.code || '');
  if (code === 'ETIMEOUT' || msg.toLowerCase().includes('timeout')) {
    console.error(
      `[API-TIMEOUT] ${req.method} ${req.originalUrl} duration=${durationMs}ms`
    );
    return fail(res, 500, 50000, '查询超时，请缩小时间范围后重试');
  }

  console.error(
    `[API-ERR] ${req.method} ${req.originalUrl} code=50000 duration=${durationMs}ms err=${msg}`
  );
  return fail(
    res,
    500,
    50000,
    msg && !msg.includes('password') ? msg : '服务器错误，请稍后重试'
  );
}
