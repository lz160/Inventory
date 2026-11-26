import sql from 'mssql';
import {
  conflictError,
  notFoundError,
  serverError,
  validationError,
} from '../../core/http/envelope';
import type {
  ChangeReceivingLine,
  ImportReceivingOrder,
  ReceivingLine,
  ReceivingLineResult,
  ReceivingOrder,
} from './types';

const lineColumns = `
  i.Id AS id, i.OrderId AS orderId, i.Sequence AS seq, i.Name AS name, i.ChineseName AS chineseName,
  i.UnitPrice AS unitPrice, i.DiscountPrice AS discountPrice, i.Barcode AS barcode,
  i.ExpectedQty AS expectedQty, i.ItemNo AS itemNo, i.UnitPrice2 AS unitPrice2, i.Supplier AS supplier,
  i.ReceivedQty AS receivedQty, i.DamagedQty AS damagedQty, i.ActualBilledPrice AS actualBilledPrice,
  i.Notes AS notes, i.LastScannedAt AS lastScannedAt, i.Version AS version
`;

type LineRow = Omit<ReceivingLine, 'lastScannedAt'> & { lastScannedAt: Date | null };
type OrderRow = LineRow & {
  headerId: string;
  title: string;
  createdAt: Date;
  completedAt: Date | null;
  headerVersion: number;
};

function toLine(row: LineRow): ReceivingLine {
  return {
    id: row.id.toLowerCase(),
    orderId: row.orderId?.toLowerCase(),
    seq: row.seq,
    name: row.name,
    chineseName: row.chineseName,
    unitPrice: row.unitPrice,
    discountPrice: row.discountPrice,
    barcode: row.barcode,
    expectedQty: row.expectedQty,
    itemNo: row.itemNo,
    unitPrice2: row.unitPrice2,
    supplier: row.supplier,
    receivedQty: row.receivedQty,
    damagedQty: row.damagedQty,
    actualBilledPrice: row.actualBilledPrice,
    notes: row.notes,
    lastScannedAt: row.lastScannedAt?.toISOString(),
    version: row.version,
  };
}

async function inReceivingTransaction<T>(
  pool: sql.ConnectionPool,
  lock: 'Shared' | 'Exclusive',
  work: (transaction: sql.Transaction) => Promise<T>
): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const result = await tx.request().input('lock', sql.VarChar(9), lock).query<{ lockResult: number }>(`
      DECLARE @result int;
      EXEC @result = sp_getapplock
        @Resource = N'WorkbenchReceiving', @LockMode = @lock, @LockOwner = N'Transaction',
        @LockTimeout = 10000;
      SELECT @result AS lockResult;
    `);
    if (result.recordset[0].lockResult < 0) {
      throw serverError('验货数据正在保存，请稍后重试');
    }
    const data = await work(tx);
    await tx.commit();
    return data;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

async function isRecorded(
  tx: sql.Transaction, operationId: string, operationType: string, targetId: string
): Promise<boolean> {
  const result = await tx.request().input('operationId', sql.UniqueIdentifier, operationId)
    .query<{ operationType: string; targetId: string }>(`
      SELECT OperationType AS operationType, TargetId AS targetId
      FROM dbo.ReceivingOperation WHERE Id = @operationId;
    `);
  const recorded = result.recordset[0];
  if (!recorded) return false;
  if (recorded.operationType !== operationType || recorded.targetId.toLowerCase() !== targetId) {
    throw conflictError('操作编号已用于另一项修改');
  }
  return true;
}

async function recordOperation(
  tx: sql.Transaction, operationId: string, operationType: string, targetId: string
) {
  await tx.request()
    .input('operationId', sql.UniqueIdentifier, operationId)
    .input('operationType', sql.VarChar(12), operationType)
    .input('targetId', sql.UniqueIdentifier, targetId)
    .query(`
      INSERT dbo.ReceivingOperation (Id, OperationType, TargetId)
      VALUES (@operationId, @operationType, @targetId);
    `);
}

async function selectOrders(tx: sql.Transaction, orderId?: string): Promise<ReceivingOrder[]> {
  const result = await tx.request().input('orderId', sql.UniqueIdentifier, orderId ?? null)
    .query<OrderRow>(`
      SELECT o.Id AS headerId, o.Title AS title, o.CreatedAt AS createdAt, o.CompletedAt AS completedAt,
        o.Version AS headerVersion, ${lineColumns}
      FROM dbo.ReceivingOrder o
      LEFT JOIN dbo.ReceivingLine i ON i.OrderId = o.Id
      WHERE @orderId IS NULL OR o.Id = @orderId
      ORDER BY o.OrderNumber, i.LineNumber;
    `);

  const orders = new Map<string, ReceivingOrder>();
  for (const row of result.recordset) {
    let order = orders.get(row.headerId);
    if (!order) {
      order = {
        id: row.headerId.toLowerCase(),
        title: row.title,
        createdAt: row.createdAt.toISOString().slice(0, 10),
        completedAt: row.completedAt?.toISOString(),
        isActive: true,
        version: row.headerVersion,
        items: [],
      };
      orders.set(row.headerId, order);
    }
    if (row.id) order.items.push(toLine(row));
  }
  return Array.from(orders.values());
}

async function getOrderVersion(tx: sql.Transaction, orderId: string): Promise<number> {
  const result = await tx.request().input('orderId', sql.UniqueIdentifier, orderId)
    .query<{ version: number }>('SELECT Version AS version FROM dbo.ReceivingOrder WHERE Id = @orderId');
  const order = result.recordset[0];
  if (!order) throw notFoundError('该进货单已不存在，请刷新列表');
  return order.version;
}

async function updateOrderCompletion(tx: sql.Transaction, orderId: string) {
  await tx.request().input('orderId', sql.UniqueIdentifier, orderId).query(`
    UPDATE dbo.ReceivingOrder SET
      Version = Version + 1,
      CompletedAt = CASE
        WHEN EXISTS (SELECT 1 FROM dbo.ReceivingLine WHERE OrderId = @orderId)
          AND NOT EXISTS (
            SELECT 1 FROM dbo.ReceivingLine WHERE OrderId = @orderId AND ReceivedQty < ExpectedQty
          )
          THEN COALESCE(CompletedAt, SYSUTCDATETIME())
        ELSE NULL
      END
    WHERE Id = @orderId;
  `);
}

export function listReceivingOrders(pool: sql.ConnectionPool): Promise<ReceivingOrder[]> {
  return inReceivingTransaction(pool, 'Shared', (tx) => selectOrders(tx));
}

export function importReceivingOrder(
  pool: sql.ConnectionPool, input: ImportReceivingOrder
): Promise<ReceivingOrder> {
  const { operationId, mode, title, items } = input;
  const orderId = input.orderId ?? operationId;

  return inReceivingTransaction(pool, 'Exclusive', async (tx) => {
    if (!(await isRecorded(tx, operationId, mode, orderId))) {
      const orderRequest = tx.request()
        .input('orderId', sql.UniqueIdentifier, orderId)
        .input('title', sql.NVarChar(255), title);
      if (mode === 'new_order') {
        await orderRequest.query('INSERT dbo.ReceivingOrder (Id, Title) VALUES (@orderId, @title);');
      } else {
        const version = await getOrderVersion(tx, orderId);
        if (mode === 'replace') {
          if (version !== input.version) throw conflictError('进货单已被更新，请确认最新内容后再替换');
          await orderRequest.query(`
            DELETE dbo.ReceivingLine WHERE OrderId = @orderId;
            UPDATE dbo.ReceivingOrder SET Title = @title, CompletedAt = NULL WHERE Id = @orderId;
          `);
        }
      }

      await tx.request()
        .input('orderId', sql.UniqueIdentifier, orderId)
        .input('items', sql.NVarChar(sql.MAX), JSON.stringify(items))
        .input('append', sql.Bit, mode === 'append')
        .query(`
          DECLARE @baseSequence int = ISNULL(
            (SELECT MAX(Sequence) FROM dbo.ReceivingLine WHERE OrderId = @orderId), 0
          );
          INSERT dbo.ReceivingLine (
            Id, OrderId, Sequence, Name, ChineseName, UnitPrice, DiscountPrice, Barcode,
            ExpectedQty, ItemNo, UnitPrice2, Supplier, ReceivedQty, DamagedQty, ActualBilledPrice, Notes
          )
          SELECT NEWID(), @orderId,
            CASE WHEN @append = 1 THEN @baseSequence + CONVERT(int, j.[key]) + 1 ELSE i.seq END,
            i.name, i.chineseName, i.unitPrice, i.discountPrice, i.barcode,
            i.expectedQty, i.itemNo, i.unitPrice2, i.supplier, 0, 0, i.actualBilledPrice, N''
          FROM OPENJSON(@items) j
          CROSS APPLY OPENJSON(j.value) WITH (
            seq int, name nvarchar(500), chineseName nvarchar(500), unitPrice decimal(18,6),
            discountPrice decimal(18,6), barcode nvarchar(100), expectedQty decimal(18,6),
            itemNo nvarchar(200), unitPrice2 decimal(18,6), supplier nvarchar(255),
            actualBilledPrice decimal(18,6)
          ) i
          ORDER BY CONVERT(int, j.[key]);
        `);
      await updateOrderCompletion(tx, orderId);
      await recordOperation(tx, operationId, mode, orderId);
    }
    const [order] = await selectOrders(tx, orderId);
    if (!order) throw notFoundError('该进货单已不存在，请刷新列表');
    return order;
  });
}

export function deleteReceivingOrder(
  pool: sql.ConnectionPool, orderId: string, expectedVersion: number
): Promise<void> {
  return inReceivingTransaction(pool, 'Exclusive', async (tx) => {
    const result = await tx.request()
      .input('orderId', sql.UniqueIdentifier, orderId)
      .input('version', sql.Int, expectedVersion)
      .query(`
        DELETE dbo.ReceivingOrder WHERE Id = @orderId AND Version = @version;
        SELECT Id FROM dbo.ReceivingOrder WHERE Id = @orderId;
      `);
    if (result.recordset.length) throw conflictError('进货单已被更新，请确认最新内容后再删除');
  });
}

async function readLine(tx: sql.Transaction, itemId: string) {
  const result = await tx.request().input('itemId', sql.UniqueIdentifier, itemId)
    .query<LineRow & { headerVersion: number; completedAt: Date | null }>(`
      SELECT ${lineColumns}, o.Version AS headerVersion, o.CompletedAt AS completedAt
      FROM dbo.ReceivingLine i JOIN dbo.ReceivingOrder o ON o.Id = i.OrderId
      WHERE i.Id = @itemId;
    `);
  const row = result.recordset[0];
  if (!row) throw notFoundError('该验货明细已不存在，请刷新列表');
  return row;
}

export function changeReceivingLine(
  pool: sql.ConnectionPool, itemId: string, input: ChangeReceivingLine
): Promise<ReceivingLineResult> {
  return inReceivingTransaction(pool, 'Exclusive', async (tx) => {
    let row = await readLine(tx, itemId);
    if (!(await isRecorded(tx, input.operationId, 'line', itemId))) {
      const changes = 'delta' in input ? { receivedQty: Math.max(0, row.receivedQty + input.delta) } : input.changes;
      if ('version' in input && row.version !== input.version) {
        throw conflictError('该商品已被更新，请查看最新实收数据后重试');
      }
      if ((changes.receivedQty ?? 0) > 999999999999) throw validationError('实收数量超过范围');

      await tx.request()
        .input('itemId', sql.UniqueIdentifier, itemId)
        .input('receivedQty', sql.Decimal(18, 6), changes.receivedQty ?? null)
        .input('damagedQty', sql.Decimal(18, 6), changes.damagedQty ?? null)
        .input('actualBilledPrice', sql.Decimal(18, 6), changes.actualBilledPrice ?? null)
        .input('notes', sql.NVarChar(2000), changes.notes ?? null)
        .input('scan', sql.Bit, 'scan' in input && input.scan)
        .query(`
          UPDATE dbo.ReceivingLine SET
            ReceivedQty = COALESCE(@receivedQty, ReceivedQty),
            DamagedQty = COALESCE(@damagedQty, DamagedQty),
            ActualBilledPrice = COALESCE(@actualBilledPrice, ActualBilledPrice),
            Notes = COALESCE(@notes, Notes),
            LastScannedAt = CASE WHEN @scan = 1 THEN SYSUTCDATETIME() ELSE LastScannedAt END,
            Version = Version + 1
          WHERE Id = @itemId;
        `);
      await updateOrderCompletion(tx, row.orderId!);
      await recordOperation(tx, input.operationId, 'line', itemId);
      row = await readLine(tx, itemId);
    }
    return {
      item: toLine(row),
      orderId: row.orderId!.toLowerCase(),
      version: row.headerVersion,
      completedAt: row.completedAt?.toISOString(),
    };
  });
}
