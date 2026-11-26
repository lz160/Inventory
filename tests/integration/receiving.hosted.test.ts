import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import sql from 'mssql';
import { closeHostedPools, getHostedStorePool, isHostedSqlEnabled } from '../../src/core/db/hostedSql';
import type { IdentityStore } from '../../src/core/db/identityStore';
import type { StoreRecord, UserSessionInfo } from '../../src/core/db/metaStore';
import { mountImsRoutes } from '../../src/imsApp';
import type { ImportedLine, ReceivingLineResult, ReceivingOrder } from '../../src/modules/receiving/types';

const testStoreIds = process.env.OP_SQL_TEST_STORE_IDS;

test('hosted receiving uses per-store SQL and atomically saves imported and scanned lines', {
  skip: !testStoreIds,
}, async (t) => {
  assert.ok(isHostedSqlEnabled());
  assert.equal(testStoreIds, '900001,900002', 'use the two dedicated test databases');
  const [a, b] = testStoreIds.split(',').map(Number);
  const now = new Date().toISOString();

  function store(id: number): StoreRecord {
    return { id, storeCode: String(id), storeName: 'SQL test store', createdAt: now, updatedAt: now };
  }

  function session(storeId: number | null, receiving = true): UserSessionInfo {
    return {
      activeStore: storeId ? store(storeId) : null,
      availableStores: [store(a), store(b)],
      expiresAt: now,
      user: {
        id: 1, username: 'sandbox', displayName: 'SQL test user', role: 'staff',
        permissions: receiving ? ['receiving'] : ['stocktake'], isActive: true,
        allStores: false, assignedStoreIds: [a, b], createdAt: now, updatedAt: now,
      },
    };
  }

  const sessions = new Map([
    ['store-a', session(a)],
    ['store-b', session(b)],
    ['stocktake-only', session(a, false)],
    ['no-store', session(null)],
  ]);
  const identity = {
    verifyUserSessionToken: (token: string) => sessions.get(token) ?? null,
    getDbOverride: () => null,
  } as unknown as IdentityStore;

  const app = express();
  app.use(express.json());
  mountImsRoutes(app, { identityStore: identity, dbMode: 'mssql' });
  const [firstPool, secondPool] = await Promise.all([getHostedStorePool(a), getHostedStorePool(b)]);
  const server = app.listen(0, '127.0.0.1');
  const newOrderId = randomUUID();
  const anotherOrderId = randomUUID();
  const operations = [newOrderId, anotherOrderId];
  const operationId = () => {
    const id = randomUUID();
    operations.push(id);
    return id;
  };
  t.after(async () => {
    try {
      for (const [pool, orderId] of [[firstPool, newOrderId], [secondPool, anotherOrderId]] as const) {
        await pool.request().input('orderId', sql.UniqueIdentifier, orderId)
          .input('operationIds', sql.NVarChar(sql.MAX), JSON.stringify(operations))
          .query(`
            DELETE dbo.ReceivingOrder WHERE Id = @orderId;
            DELETE dbo.ReceivingOperation WHERE Id IN (SELECT CONVERT(uniqueidentifier, value) FROM OPENJSON(@operationIds));
          `);
      }
    } finally {
      await closeHostedPools();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    }
  });
  if (!server.listening) await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  async function request<T>(path: string, token = 'store-a', storeId = a, method = 'GET', body?: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}/api/receiving${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-Store-Id': String(storeId), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()).data as T };
  }

  assert.equal((await request('/orders', 'invalid')).status, 401);
  assert.equal((await request('/orders', 'no-store')).status, 403);
  assert.equal((await request('/orders', 'stocktake-only')).status, 403);
  assert.equal((await request('/orders', 'store-a', b)).status, 409);
  assert.deepEqual((await request<ReceivingOrder[]>('/orders')).data, []);

  const item: ImportedLine = {
    seq: 1, name: '测试品', chineseName: '雪糕', barcode: '000100', expectedQty: 4, itemNo: 'SKU1',
    supplier: '供应商', unitPrice: 1.23456, discountPrice: 0, unitPrice2: 2, actualBilledPrice: 1.23456,
  };
  const orderInput = { operationId: newOrderId, mode: 'new_order', title: '测试进货', items: [item] };
  const created = await request<ReceivingOrder>('/orders/import', 'store-a', a, 'POST', orderInput);
  assert.equal(created.status, 201);
  assert.equal(created.data.items[0].barcode, '000100');
  assert.equal(created.data.items[0].unitPrice, 1.23456);
  assert.equal(created.data.items[0].chineseName, '雪糕');
  const repeated = await request<ReceivingOrder>('/orders/import', 'store-a', a, 'POST', orderInput);
  assert.equal(repeated.data.id, created.data.id);
  assert.equal(repeated.data.items.length, 1);

  const secondOrders = await request<ReceivingOrder[]>('/orders', 'store-b', b);
  assert.deepEqual(secondOrders.data, []);
  const secondCreated = await request<ReceivingOrder>('/orders/import', 'store-b', b, 'POST', {
    ...orderInput, operationId: anotherOrderId,
  });
  assert.equal(secondCreated.status, 201);
  await assert.rejects(firstPool.request().query(`SELECT TOP (1) Id FROM [op_store_${b}].dbo.ReceivingOrder`));

  const line = created.data.items[0];
  const path = `/lines/${line.id}`;
  const scan = { delta: 1, scan: true, operationId: operationId() };
  assert.equal((await request(path, 'store-b', b, 'PATCH', scan)).status, 404);

  const firstScan = await request<ReceivingLineResult>(path, 'store-a', a, 'PATCH', scan);
  assert.equal(firstScan.status, 200);
  assert.ok(firstScan.data.item.lastScannedAt);
  assert.equal(firstScan.data.item.receivedQty, 1);
  const retried = await request<ReceivingLineResult>(path, 'store-a', a, 'PATCH', scan);
  assert.equal(retried.data.item.receivedQty, 1);

  const further = await Promise.all(Array.from({ length: 3 }, () => request<ReceivingLineResult>(
    path, 'store-a', a, 'PATCH', { ...scan, operationId: operationId() }
  )));
  assert.ok(further.every((result) => result.status === 200));
  assert.deepEqual(further.map((result) => result.data.item.receivedQty).sort(), [2, 3, 4]);

  const [completed] = (await request<ReceivingOrder[]>('/orders')).data;
  assert.equal(completed.items[0].receivedQty, 4);
  assert.ok(completed.completedAt);
  const stale = await request(path, 'store-a', a, 'PATCH', {
    operationId: operationId(), changes: { receivedQty: 2 }, version: line.version,
  });
  assert.equal(stale.status, 409);
  const edited = await request<ReceivingLineResult>(path, 'store-a', a, 'PATCH', {
    operationId: operationId(), changes: { receivedQty: 2, damagedQty: 1, notes: '包装破损' }, version: completed.items[0].version,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.item.notes, '包装破损');
  assert.equal(edited.data.item.damagedQty, 1);
  assert.equal(edited.data.completedAt, undefined);
  assert.equal((await request(`/orders/${completed.id}`, 'store-a', a, 'DELETE', { version: completed.version })).status, 409);

  const append = await request<ReceivingOrder>('/orders/import', 'store-a', a, 'POST', {
    ...orderInput, operationId: operationId(), mode: 'append', orderId: completed.id,
    items: [{ ...item, barcode: '000200' }],
  });
  assert.equal(append.status, 201);
  assert.deepEqual(append.data.items.map((entry) => [entry.seq, entry.barcode, entry.receivedQty]),
    [[1, '000100', 2], [2, '000200', 0]]);
  const replacement = {
    ...orderInput, operationId: operationId(), mode: 'replace', orderId: completed.id, title: '更换的进货单',
  };
  assert.equal((await request('/orders/import', 'store-a', a, 'POST', {
    ...replacement, version: completed.version,
  })).status, 409);
  const replaced = await request<ReceivingOrder>('/orders/import', 'store-a', a, 'POST', {
    ...replacement, version: append.data.version,
  });
  assert.equal(replaced.status, 201);
  assert.equal(replaced.data.id, completed.id);
  assert.equal(replaced.data.title, replacement.title);
  assert.equal(replaced.data.items.length, 1);
  assert.equal(replaced.data.items[0].receivedQty, 0);
  assert.equal((await request(`/orders/${completed.id}`, 'store-a', a, 'DELETE', {
    version: replaced.data.version,
  })).status, 200);
  assert.deepEqual((await request<ReceivingOrder[]>('/orders')).data, []);

  const [secondOrder] = (await request<ReceivingOrder[]>('/orders', 'store-b', b)).data;
  assert.equal(secondOrder.items[0].receivedQty, 0);
});
