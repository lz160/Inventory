import sql from 'mssql';
import { getMssqlPool } from '../../core/db/pool';
import { SqliteSandbox } from '../../core/db/sqliteSandbox';
import { bratislavaLocalMidnightToUtc, addDaysYyyyMmDd, toBratislavaLocalDate } from './analytics';
import { SalesSummaryResult } from './types';

export interface DailySalesBucket {
  localDate: string;
  qty: number;
  revenue: number;
}

export interface RawAggregatedBarcodeSale {
  Barcode: string;
  FallbackNazov: string | null;
  SoldQty: number;
  Revenue: number;
}

export interface G1SalesEnrichment {
  Barcode: string;
  Nazov: string | null;
  Cena: number | null;
  Cena2: number | null;
  Surplus: number | null;
  WarningAt: number;
}

export interface SalesQueryParams {
  from: string;
  to: string;
  barcode?: string;
  q?: string;
}

export interface SalesRepository {
  getSummary(params: SalesQueryParams): Promise<Omit<SalesSummaryResult, 'from' | 'to'>>;
  getDailyBuckets(params: SalesQueryParams): Promise<DailySalesBucket[]>;
  getAggregatedSalesByBarcode(params: SalesQueryParams): Promise<RawAggregatedBarcodeSale[]>;
  getAllG1ProductsForEnrichment(barcodes?: string[]): Promise<Map<string, G1SalesEnrichment>>;
  getStockedProductsForSlowAndRestock(): Promise<G1SalesEnrichment[]>;
}

export class MssqlSalesRepository implements SalesRepository {
  private buildWhere(
    request: sql.Request,
    params: SalesQueryParams
  ): string {
    const startUtc = bratislavaLocalMidnightToUtc(params.from);
    const endExclusiveUtc = bratislavaLocalMidnightToUtc(addDaysYyyyMmDd(params.to, 1));

    request.input('fromUtc', sql.DateTime2, startUtc);
    request.input('toExclusiveUtc', sql.DateTime2, endExclusiveUtc);

    const clauses = [
      `d.Delta < 0`,
      `l.AppName NOT IN ('Tedious', 'node-mssql')`,
      `l.ChangeTime >= @fromUtc`,
      `l.ChangeTime < @toExclusiveUtc`,
    ];

    if (params.barcode && params.barcode.trim()) {
      clauses.push(`TRIM(d.Barcode) = @barcode`);
      request.input('barcode', sql.VarChar(13), params.barcode.trim());
    }
    if (params.q && params.q.trim()) {
      clauses.push(`(TRIM(d.Barcode) LIKE @q OR d.Nazov LIKE @q)`);
      request.input('q', sql.NVarChar(512), `%${params.q.trim()}%`);
    }
    return `WHERE ${clauses.join(' AND ')}`;
  }

  async getSummary(params: SalesQueryParams) {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    const whereSql = this.buildWhere(req, params);
    const res = await req.query(`
      SELECT
        COALESCE(SUM(-d.Delta), 0) AS totalQty,
        COALESCE(SUM(-d.Delta * COALESCE(d.Cena, 0)), 0) AS totalRevenue,
        COALESCE(SUM(CASE WHEN COALESCE(d.Cena, 0) = 0 THEN -d.Delta ELSE 0 END), 0) AS zeroPriceQty
      FROM dbo.SalesLogDetail d
      JOIN dbo.SalesLog l ON l.LogId = d.LogId
      ${whereSql}
    `);
    const row = res.recordset[0] || {};
    const totalQty = Number(row.totalQty ?? 0) || 0;
    const totalRevenue = Number(row.totalRevenue ?? 0) || 0;
    const zeroPriceQty = Number(row.zeroPriceQty ?? 0) || 0;
    const zeroPricePct = totalQty > 0 ? Number(((zeroPriceQty / totalQty) * 100).toFixed(1)) : 0;
    return { totalQty, totalRevenue, zeroPriceQty, zeroPricePct };
  }

  async getDailyBuckets(params: SalesQueryParams): Promise<DailySalesBucket[]> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    const whereSql = this.buildWhere(req, params);

    // Aggregate by local Europe/Bratislava calendar day inside SQL Server (SQL Server 2016+ AT TIME ZONE)
    const res = await req.query(`
      SELECT
        CONVERT(VARCHAR(10),
          CAST(CAST(l.ChangeTime AS DATETIME2) AT TIME ZONE 'UTC' AT TIME ZONE 'Central Europe Standard Time' AS DATE),
          120
        ) AS localDate,
        COALESCE(SUM(-d.Delta), 0) AS qty,
        COALESCE(SUM(-d.Delta * COALESCE(d.Cena, 0)), 0) AS revenue
      FROM dbo.SalesLogDetail d
      JOIN dbo.SalesLog l ON l.LogId = d.LogId
      ${whereSql}
      GROUP BY CAST(CAST(l.ChangeTime AS DATETIME2) AT TIME ZONE 'UTC' AT TIME ZONE 'Central Europe Standard Time' AS DATE)
      ORDER BY localDate ASC
    `);

    return res.recordset.map((r) => ({
      localDate: String(r.localDate),
      qty: Number(r.qty ?? 0) || 0,
      revenue: Number(r.revenue ?? 0) || 0,
    }));
  }

  async getAggregatedSalesByBarcode(params: SalesQueryParams): Promise<RawAggregatedBarcodeSale[]> {
    const pool = await getMssqlPool('saledata');
    const req = pool.request();
    const whereSql = this.buildWhere(req, params);
    const res = await req.query(`
      SELECT
        TRIM(d.Barcode) AS Barcode,
        MAX(d.Nazov) AS FallbackNazov,
        COALESCE(SUM(-d.Delta), 0) AS SoldQty,
        COALESCE(SUM(-d.Delta * COALESCE(d.Cena, 0)), 0) AS Revenue
      FROM dbo.SalesLogDetail d
      JOIN dbo.SalesLog l ON l.LogId = d.LogId
      ${whereSql}
      GROUP BY TRIM(d.Barcode)
      ORDER BY SoldQty DESC, TRIM(d.Barcode) ASC
    `);

    return res.recordset.map((r) => ({
      Barcode: String(r.Barcode ?? '').trim(),
      FallbackNazov: r.FallbackNazov ? String(r.FallbackNazov) : null,
      SoldQty: Number(r.SoldQty ?? 0) || 0,
      Revenue: Number(r.Revenue ?? 0) || 0,
    }));
  }

  async getAllG1ProductsForEnrichment(barcodes?: string[]): Promise<Map<string, G1SalesEnrichment>> {
    const pool = await getMssqlPool('sklad');
    const map = new Map<string, G1SalesEnrichment>();

    if (barcodes && barcodes.length > 0) {
      const unique = Array.from(new Set(barcodes.map((b) => b.trim()).filter(Boolean)));
      // Chunk into batches of 500 per §7.3 rule 8
      for (let start = 0; start < unique.length; start += 500) {
        const chunk = unique.slice(start, start + 500);
        const req = pool.request();
        const ph = chunk.map((bc, idx) => {
          const p = `b_${idx}`;
          req.input(p, sql.VarChar(13), bc);
          return `@${p}`;
        });
        const res = await req.query(`
          SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt
          FROM dbo.g1
          WHERE TRIM(Barcode) IN (${ph.join(', ')})
        `);
        for (const r of res.recordset) {
          const bc = String(r.Barcode ?? '').trim();
          map.set(bc, {
            Barcode: bc,
            Nazov: r.Nazov === null || r.Nazov === undefined ? null : String(r.Nazov),
            Cena: r.Cena === null || r.Cena === undefined ? null : Number(r.Cena),
            Cena2: r.Cena2 === null || r.Cena2 === undefined ? null : Number(r.Cena2),
            Surplus: r.Surplus === null || r.Surplus === undefined ? null : Number(r.Surplus),
            WarningAt: Number(r.WarningAt ?? 0) || 0,
          });
        }
      }
      return map;
    }

    const res = await pool.request().query(`
      SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt
      FROM dbo.g1
    `);
    for (const r of res.recordset) {
      const bc = String(r.Barcode ?? '').trim();
      map.set(bc, {
        Barcode: bc,
        Nazov: r.Nazov === null || r.Nazov === undefined ? null : String(r.Nazov),
        Cena: r.Cena === null || r.Cena === undefined ? null : Number(r.Cena),
        Cena2: r.Cena2 === null || r.Cena2 === undefined ? null : Number(r.Cena2),
        Surplus: r.Surplus === null || r.Surplus === undefined ? null : Number(r.Surplus),
        WarningAt: Number(r.WarningAt ?? 0) || 0,
      });
    }
    return map;
  }

  async getStockedProductsForSlowAndRestock(): Promise<G1SalesEnrichment[]> {
    const pool = await getMssqlPool('sklad');
    const res = await pool.request().query(`
      SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt
      FROM dbo.g1
      WHERE Surplus > 0
      ORDER BY Barcode ASC
    `);
    return res.recordset.map((r) => ({
      Barcode: String(r.Barcode ?? '').trim(),
      Nazov: r.Nazov === null || r.Nazov === undefined ? null : String(r.Nazov),
      Cena: r.Cena === null || r.Cena === undefined ? null : Number(r.Cena),
      Cena2: r.Cena2 === null || r.Cena2 === undefined ? null : Number(r.Cena2),
      Surplus: r.Surplus === null || r.Surplus === undefined ? null : Number(r.Surplus),
      WarningAt: Number(r.WarningAt ?? 0) || 0,
    }));
  }
}

export class SqliteSalesRepository implements SalesRepository {
  constructor(private sandbox: SqliteSandbox) {}

  private buildWhere(params: SalesQueryParams): { whereSql: string; sqlParams: any[] } {
    const startUtc = bratislavaLocalMidnightToUtc(params.from).toISOString();
    const endExclusiveUtc = bratislavaLocalMidnightToUtc(addDaysYyyyMmDd(params.to, 1)).toISOString();

    const clauses = [
      `d.Delta < 0`,
      `l.AppName NOT IN ('Tedious', 'node-mssql')`,
      `l.ChangeTime >= ?`,
      `l.ChangeTime < ?`,
    ];
    const sqlParams: any[] = [startUtc, endExclusiveUtc];

    if (params.barcode && params.barcode.trim()) {
      clauses.push(`TRIM(d.Barcode) = ?`);
      sqlParams.push(params.barcode.trim());
    }
    if (params.q && params.q.trim()) {
      const pattern = `%${params.q.trim()}%`;
      clauses.push(`(TRIM(d.Barcode) LIKE ? OR d.Nazov LIKE ?)`);
      sqlParams.push(pattern, pattern);
    }

    return {
      whereSql: `WHERE ${clauses.join(' AND ')}`,
      sqlParams,
    };
  }

  async getSummary(params: SalesQueryParams) {
    const { whereSql, sqlParams } = this.buildWhere(params);
    const row = this.sandbox.db
      .prepare(`
        SELECT
          COALESCE(SUM(-d.Delta), 0) AS totalQty,
          COALESCE(SUM(-d.Delta * COALESCE(d.Cena, 0)), 0) AS totalRevenue,
          COALESCE(SUM(CASE WHEN COALESCE(d.Cena, 0) = 0 THEN -d.Delta ELSE 0 END), 0) AS zeroPriceQty
        FROM SalesLogDetail d
        JOIN SalesLog l ON l.LogId = d.LogId
        ${whereSql}
      `)
      .get(...sqlParams) as any;

    const totalQty = Number(row?.totalQty ?? 0) || 0;
    const totalRevenue = Number(row?.totalRevenue ?? 0) || 0;
    const zeroPriceQty = Number(row?.zeroPriceQty ?? 0) || 0;
    const zeroPricePct = totalQty > 0 ? Number(((zeroPriceQty / totalQty) * 100).toFixed(1)) : 0;
    return { totalQty, totalRevenue, zeroPriceQty, zeroPricePct };
  }

  async getDailyBuckets(params: SalesQueryParams): Promise<DailySalesBucket[]> {
    const { whereSql, sqlParams } = this.buildWhere(params);
    const rows = this.sandbox.db
      .prepare(`
        SELECT l.ChangeTime AS ChangeTime, -d.Delta AS qty, -d.Delta * COALESCE(d.Cena, 0) AS revenue
        FROM SalesLogDetail d
        JOIN SalesLog l ON l.LogId = d.LogId
        ${whereSql}
        ORDER BY l.ChangeTime ASC
      `)
      .all(...sqlParams) as Array<{ ChangeTime: string; qty: number; revenue: number }>;

    const map = new Map<string, { qty: number; revenue: number }>();
    for (const r of rows) {
      const localDate = toBratislavaLocalDate(r.ChangeTime);
      const cur = map.get(localDate) || { qty: 0, revenue: 0 };
      cur.qty += Number(r.qty ?? 0) || 0;
      cur.revenue += Number(r.revenue ?? 0) || 0;
      map.set(localDate, cur);
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([localDate, val]) => ({
        localDate,
        qty: val.qty,
        revenue: val.revenue,
      }));
  }

  async getAggregatedSalesByBarcode(params: SalesQueryParams): Promise<RawAggregatedBarcodeSale[]> {
    const { whereSql, sqlParams } = this.buildWhere(params);
    const rows = this.sandbox.db
      .prepare(`
        SELECT
          TRIM(d.Barcode) AS Barcode,
          MAX(d.Nazov) AS FallbackNazov,
          COALESCE(SUM(-d.Delta), 0) AS SoldQty,
          COALESCE(SUM(-d.Delta * COALESCE(d.Cena, 0)), 0) AS Revenue
        FROM SalesLogDetail d
        JOIN SalesLog l ON l.LogId = d.LogId
        ${whereSql}
        GROUP BY TRIM(d.Barcode)
        ORDER BY SoldQty DESC, TRIM(d.Barcode) ASC
      `)
      .all(...sqlParams) as any[];

    return rows.map((r) => ({
      Barcode: String(r.Barcode ?? '').trim(),
      FallbackNazov: r.FallbackNazov ? String(r.FallbackNazov) : null,
      SoldQty: Number(r.SoldQty ?? 0) || 0,
      Revenue: Number(r.Revenue ?? 0) || 0,
    }));
  }

  async getAllG1ProductsForEnrichment(barcodes?: string[]): Promise<Map<string, G1SalesEnrichment>> {
    const map = new Map<string, G1SalesEnrichment>();
    let rows: any[] = [];
    if (barcodes && barcodes.length > 0) {
      const unique = Array.from(new Set(barcodes.map((b) => b.trim()).filter(Boolean)));
      for (let start = 0; start < unique.length; start += 500) {
        const chunk = unique.slice(start, start + 500);
        const ph = chunk.map(() => '?').join(', ');
        const part = this.sandbox.db
          .prepare(`SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt FROM g1 WHERE TRIM(Barcode) IN (${ph})`)
          .all(...chunk);
        rows.push(...part);
      }
    } else {
      rows = this.sandbox.db
        .prepare(`SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt FROM g1`)
        .all();
    }

    for (const r of rows) {
      const bc = String(r.Barcode ?? '').trim();
      map.set(bc, {
        Barcode: bc,
        Nazov: r.Nazov === null || r.Nazov === undefined ? null : String(r.Nazov),
        Cena: r.Cena === null || r.Cena === undefined ? null : Number(r.Cena),
        Cena2: r.Cena2 === null || r.Cena2 === undefined ? null : Number(r.Cena2),
        Surplus: r.Surplus === null || r.Surplus === undefined ? null : Number(r.Surplus),
        WarningAt: Number(r.WarningAt ?? 0) || 0,
      });
    }
    return map;
  }

  async getStockedProductsForSlowAndRestock(): Promise<G1SalesEnrichment[]> {
    const rows = this.sandbox.db
      .prepare(`SELECT TRIM(Barcode) AS Barcode, Nazov, Cena, Cena2, Surplus, WarningAt FROM g1 WHERE Surplus > 0 ORDER BY Barcode ASC`)
      .all() as any[];

    return rows.map((r) => ({
      Barcode: String(r.Barcode ?? '').trim(),
      Nazov: r.Nazov === null || r.Nazov === undefined ? null : String(r.Nazov),
      Cena: r.Cena === null || r.Cena === undefined ? null : Number(r.Cena),
      Cena2: r.Cena2 === null || r.Cena2 === undefined ? null : Number(r.Cena2),
      Surplus: r.Surplus === null || r.Surplus === undefined ? null : Number(r.Surplus),
      WarningAt: Number(r.WarningAt ?? 0) || 0,
    }));
  }
}
