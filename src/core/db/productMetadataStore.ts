import sql from 'mssql';
import { CATEGORY_DICTIONARY, type CategoryDef } from '../../modules/sales/category-rules';
import { forbiddenError, validationError } from '../http/envelope';
import { getHostedStorePool } from './hostedSql';
import type { ProductMetaRow } from './metaStore';
import { getActiveStoreId } from './pool';

type Awaitable<T> = T | Promise<T>;
type CategoryAssignment = { barcode: string; category: string };

export interface ProductMetadataStore {
  listCategories(): Awaitable<CategoryDef[]>;
  getAllProductMetaMap(barcodes?: string[]): Awaitable<Map<string, ProductMetaRow>>;
  upsertProductMeta(
    barcode: string,
    category: string | null,
    nameZh: string | null,
    updatedBy: string,
  ): Awaitable<ProductMetaRow>;
  batchUpsertCategories(items: CategoryAssignment[], updatedBy: string): Awaitable<number>;
  deleteProductMeta(barcode: string): Awaitable<void>;
}

export async function initializeHostedProductMetadata(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().input('categories', sql.NVarChar(sql.MAX), JSON.stringify(CATEGORY_DICTIONARY)).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

    DECLARE @lockResult INT;
    EXEC @lockResult = sys.sp_getapplock
      @Resource = N'receiving-product-metadata-schema',
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = 10000;
    IF @lockResult < 0 THROW 50004, 'Could not lock product metadata schema', 1;

    IF OBJECT_ID(N'dbo.categories', N'U') IS NULL
      CREATE TABLE dbo.categories (
        code NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
        name_sk NVARCHAR(256) NOT NULL,
        name_zh NVARCHAR(256) NOT NULL,
        sort_order INT NOT NULL
      );

    IF OBJECT_ID(N'dbo.product_meta', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.product_meta (
        barcode NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
        category NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NULL REFERENCES dbo.categories(code),
        name_zh NVARCHAR(256) NULL,
        updated_by NVARCHAR(128) NOT NULL,
        updated_at DATETIME2(3) NOT NULL
      );
      CREATE INDEX IX_product_meta_category ON dbo.product_meta(category);
    END;

    INSERT INTO dbo.categories (code, name_sk, name_zh, sort_order)
    SELECT source.code, source.name_sk, source.name_zh, source.sort_order
    FROM OPENJSON(@categories) WITH (
      code NVARCHAR(64), name_sk NVARCHAR(256), name_zh NVARCHAR(256), sort_order INT
    ) AS source
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.categories AS existing
      WHERE existing.code = source.code COLLATE Latin1_General_100_BIN2
    );

    COMMIT TRANSACTION;
  `);
}

type SqlProductMetaRow = Omit<ProductMetaRow, 'updated_at'> & { updated_at: Date };

function mapMetadataRow(row: SqlProductMetaRow): ProductMetaRow {
  return { ...row, updated_at: row.updated_at.toISOString() };
}

export class HostedProductMetadataStore implements ProductMetadataStore {
  private pool() {
    const storeId = getActiveStoreId();
    if (storeId === null) throw forbiddenError('请先选择要操作的门店后再继续');
    return getHostedStorePool(storeId);
  }

  async listCategories(): Promise<CategoryDef[]> {
    const pool = await this.pool();
    const result = await pool.request().query<CategoryDef>(`
      SELECT code, name_sk, name_zh, sort_order FROM dbo.categories ORDER BY sort_order, code
    `);
    return result.recordset;
  }

  async getAllProductMetaMap(barcodes?: string[]): Promise<Map<string, ProductMetaRow>> {
    if (barcodes?.length === 0) return new Map();
    const pool = await this.pool();
    const result = await pool.request()
      .input('barcodes', sql.NVarChar(sql.MAX), barcodes ? JSON.stringify(barcodes.map((barcode) => barcode.trim())) : null)
      .query<SqlProductMetaRow>(`
        SELECT barcode, category, name_zh, updated_by, updated_at FROM dbo.product_meta
        WHERE @barcodes IS NULL OR barcode IN (
          SELECT value COLLATE Latin1_General_100_BIN2 FROM OPENJSON(@barcodes)
        )
      `);
    return new Map(result.recordset.map((row) => [row.barcode, mapMetadataRow(row)]));
  }

  async upsertProductMeta(
    barcode: string,
    category: string | null,
    nameZh: string | null,
    updatedBy: string,
  ): Promise<ProductMetaRow> {
    if (category && !(await this.listCategories()).some((definition) => definition.code === category)) {
      throw validationError(`无效的品类编码: ${category}`);
    }
    const pool = await this.pool();
    const result = await pool.request()
      .input('barcode', sql.NVarChar(128), barcode.trim())
      .input('category', sql.NVarChar(64), category)
      .input('name_zh', sql.NVarChar(256), nameZh)
      .input('updated_by', sql.NVarChar(128), updatedBy)
      .query<SqlProductMetaRow>(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;

        UPDATE dbo.product_meta WITH (UPDLOCK, SERIALIZABLE)
        SET category = @category,
            name_zh = CASE WHEN @name_zh IS NULL THEN name_zh ELSE NULLIF(@name_zh, N'') END,
            updated_by = @updated_by,
            updated_at = SYSUTCDATETIME()
        WHERE barcode = @barcode;

        IF @@ROWCOUNT = 0
          INSERT INTO dbo.product_meta (barcode, category, name_zh, updated_by, updated_at)
          VALUES (@barcode, @category, NULLIF(@name_zh, N''), @updated_by, SYSUTCDATETIME());

        SELECT barcode, category, name_zh, updated_by, updated_at FROM dbo.product_meta WHERE barcode = @barcode;
        COMMIT TRANSACTION;
      `);
    return mapMetadataRow(result.recordset[0]);
  }

  async batchUpsertCategories(items: CategoryAssignment[], updatedBy: string): Promise<number> {
    const assignments = new Map(items.map(({ barcode, category }) => [barcode.trim(), category]));
    const rows = Array.from(assignments, ([barcode, category]) => ({ barcode, category }));
    const pool = await this.pool();
    await pool.request()
      .input('items', sql.NVarChar(sql.MAX), JSON.stringify(rows))
      .input('updated_by', sql.NVarChar(128), updatedBy)
      .query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;

        DECLARE @now DATETIME2(3) = SYSUTCDATETIME();
        DECLARE @assignments TABLE (
          barcode NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
          category NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL
        );
        INSERT @assignments (barcode, category)
        SELECT barcode, category FROM OPENJSON(@items) WITH (barcode NVARCHAR(128), category NVARCHAR(64));

        UPDATE existing
        SET category = source.category, updated_by = @updated_by, updated_at = @now
        FROM dbo.product_meta AS existing WITH (UPDLOCK, SERIALIZABLE)
        JOIN @assignments AS source ON existing.barcode = source.barcode;

        INSERT INTO dbo.product_meta (barcode, category, updated_by, updated_at)
        SELECT source.barcode, source.category, @updated_by, @now
        FROM @assignments AS source
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.product_meta AS existing WITH (UPDLOCK, SERIALIZABLE)
          WHERE existing.barcode = source.barcode
        );

        COMMIT TRANSACTION;
      `);
    return items.length;
  }

  async deleteProductMeta(barcode: string): Promise<void> {
    const pool = await this.pool();
    await pool.request().input('barcode', sql.NVarChar(128), barcode.trim()).query(
      'DELETE FROM dbo.product_meta WHERE barcode = @barcode'
    );
  }
}
