import { useCallback, useEffect, useRef, useState } from 'react';
import { ImsApiError, imsFetch } from '../../utils/imsApi';
import type { PurchaseItem } from '../../utils/reconciliation';
import { normalizeReceivingLineResult, normalizeReceivingOrder, normalizeReceivingOrders } from './normalize';
import type { ChangeReceivingLine, ReceivingChanges, ReceivingLineResult, ReceivingMode, ReceivingOrder } from './types';

function request<T>(storeId: number, path: string, options: RequestInit = {}): Promise<T> {
  return imsFetch<T>(`/api/receiving${path}`, {
    ...options,
    headers: { 'X-Store-Id': String(storeId) },
  });
}

async function write<T>(storeId: number, path: string, method: string, body: unknown): Promise<T> {
  const options = { method, body: JSON.stringify(body) };
  try {
    return await request(storeId, path, options);
  } catch (err) {
    // Reuse the same operation ID when the first response may have been lost after commit.
    const retryable = err instanceof TypeError || (err instanceof ImsApiError && err.httpStatus >= 500);
    if (!retryable) throw err;
    return request(storeId, path, options);
  }
}

export function useReceivingOrders(storeId: number, visible: boolean) {
  const [orders, setOrders] = useState<ReceivingOrder[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const active = useRef(false);
  const loaded = useRef(false);
  const read = useRef<AbortController | null>(null);
  const queued = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    if (!active.current || queued.current) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    if (!loaded.current) setLoadState('loading');
    try {
      const raw = await request<unknown>(storeId, '/orders', { signal: controller.signal });
      const latest = normalizeReceivingOrders(raw);
      if (!controller.signal.aborted) {
        setOrders(latest);
        loaded.current = true;
        setLoadState('ready');
      }
    } catch {
      if (!controller.signal.aborted && !loaded.current) setLoadState('error');
    }
  }, [storeId]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      read.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      read.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, visible]);

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    read.current?.abort();
    queued.current++;
    const result = writes.current.then(() => {
      if (!active.current) throw new Error('门店已切换');
      return operation();
    });
    writes.current = result.then(
      () => { queued.current--; },
      (err) => {
        queued.current--;
        if (err instanceof ImsApiError && [404, 409].includes(err.httpStatus)) void refresh();
      }
    );
    return result;
  }

  function saveImport(items: PurchaseItem[], title: string, mode: ReceivingMode, order?: ReceivingOrder) {
    return enqueue(async () => {
      const saved = normalizeReceivingOrder(
        await write<unknown>(storeId, '/orders/import', 'POST', {
          operationId: crypto.randomUUID(), items, title, mode, orderId: order?.id, version: order?.version,
        })
      );
      setOrders((previous) => {
        const safePrev = Array.isArray(previous) ? previous : [];
        return safePrev.some((item) => item.id === saved.id)
          ? safePrev.map((item) => item.id === saved.id ? saved : item)
          : [...safePrev, saved];
      });
      return saved;
    });
  }

  function removeOrder(order: ReceivingOrder) {
    return enqueue(async () => {
      await write(storeId, `/orders/${order.id}`, 'DELETE', { version: order.version });
      setOrders((previous) => (Array.isArray(previous) ? previous : []).filter((item) => item.id !== order.id));
    });
  }

  function saveLine(itemId: string, input: ChangeReceivingLine) {
    return enqueue(async () => {
      const result: ReceivingLineResult = normalizeReceivingLineResult(
        await write<unknown>(storeId, `/lines/${itemId}`, 'PATCH', input)
      );
      setOrders((previous) => (Array.isArray(previous) ? previous : []).map((order) => {
        if (order.id !== result.orderId) return order;
        const safeItems = Array.isArray(order.items) ? order.items : [];
        return {
          ...order,
          // Keep destructive changes guarded when another device changed other lines.
          version: result.version === order.version + 1 ? result.version : order.version,
          completedAt: result.completedAt,
          items: safeItems.map((item) => item.id === itemId ? result.item : item),
        };
      }));
      return result.item;
    });
  }

  return {
    orders, loadState, refresh, saveImport, removeOrder,
    editLine: (itemId: string, changes: ReceivingChanges, version: number) =>
      saveLine(itemId, { changes, version, operationId: crypto.randomUUID() }),
    adjustLine: (itemId: string, delta: number, scan: boolean) =>
      saveLine(itemId, { delta, scan, operationId: crypto.randomUUID() }),
  };
}
