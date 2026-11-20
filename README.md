# 门店进销存与验货工作台 (Receiving + IMS M1/M3/M2)

集成三大生产库存管理模块至进货验货工作台：
- **货单验货 (Receiving Workbench)**：保留原有的多货单核验、极速扫码、差异审计与双模板 `.xlsx` 导出。
- **M1 库存管理 (`/api/g1/*`)**：32 字段 `SKLAD.dbo.g1` 商品主数据筛选/分页/排序、新建查重 (`40901`)、29 字段白名单编辑、`PriceHistory` 历史追溯、防全表保护批量改价、低库存告警与库存 XLSX 导出。
- **M3 实物盘点 (`/api/stocktakes/*`)**：手持端友好扫码盘点、录行即写回 `g1.Surplus`（"边盘边销"）及可选 `WarningAt`、提交锁定、级联删除与差异报告 XLSX 导出。
- **M2 销售分析 (`/api/sales/*`)**：`Europe/Bratislava` 时区夏令时日切、ISO-8601 周聚合、`Delta < 0` 且排除 `Tedious`/`node-mssql`、含 23% VAT 毛利测算、滞销/30天补货建议、78 类斯/中双语智能品类归类与多工作表 XLSX 导出。

---

## 环境变量说明 (`.env.example`)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GEMINI_API_KEY` | `""` | 进货单图片/文本 AI 解析用 Key |
| `MSSQL_SKLAD_SERVER` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` | `"" / 1433 / "" / "" / SKLAD` | SQL Server 商品主库 `SKLAD` 连接参数 |
| `MSSQL_SALEDATA_SERVER` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` | `"" / 1433 / "" / "" / SaleData` | SQL Server 销售与盘点库 `SaleData` 连接参数 |
| `MSSQL_POOL_MAX` | `10` | 单连接池最大连接数 |
| `MSSQL_REQUEST_TIMEOUT_MS` | `30000` | 单条 SQL 查询超时时间 (ms) |
| `MSSQL_ENCRYPT` | `false` | 内网/WireGuard 隧道默认关闭；公网连接请设 `true` |
| `MSSQL_TRUST_SERVER_CERTIFICATE` | `true` | 内网自签证书兼容开关 |
| `IMS_META_DB_PATH` | `./data/ims_meta.db` | 本地 SQLite 品类字典 (`categories`, `product_meta`) 存储路径 |

---

## 数据库账号与初始化

1. **SQL Server `SKLAD` 账号权限**：需要 `dbo.g1` 的 `SELECT / INSERT / UPDATE / DELETE` 权限。
2. **SQL Server `SaleData` 账号权限**：需要 `dbo.SalesLog`、`dbo.SalesLogDetail` 的 `SELECT` 权限，以及运行 `migrations/001_saledata_tables.sql` 建立并读写 `dbo.PriceHistory`、`dbo.Stocktake`、`dbo.StocktakeLine` 的权限。
3. **迁移脚本**：
   - `migrations/001_saledata_tables.sql`：幂等创建 SQL Server `SaleData` 所需三表与索引。
   - `migrations/002_sqlite_meta.sql`：幂等创建 SQLite `categories` 与 `product_meta`。
   - `migrations/seed_test_data.sql`：预演环境（仅测试库）12 条代表性样本商品。

---

## 启动与测试

```bash
# 安装依赖
npm install

# 生产 / 直连 SQL Server 模式启动 (端口 3000)
npm run dev

# 仅无 SQL Server 的本地演示/验收沙盒模式 (使用内置 §10.1 种子库)
IMS_DB_MODE=sqlite-seed npm run dev

# 运行全部 20 项单元测试与端到端集成验收测试
npx tsx --test tests/unit/*.test.ts tests/integration/*.test.ts

# TypeScript 静态校验与生产构建
npm run lint
npm run build
```

---

## 时区、货币与已知约定

- **业务时区**：严格固定 `Europe/Bratislava`（自动适配 CET UTC+1 / CEST UTC+2 夏令时），盘点默认日期与销售按日/周切分均以门店本地时间为准。
- **货币与增值税 (EUR / VAT 23%)**：`Cena` 为含 23% VAT 零售价，`Cena2` 为不含税进货价。净售价 = `Cena / 1.23`；`Cena = 0` 时净毛利率显示 `—`（并在汇总卡片标注 `€0.00` 销量占比）。
- **默认快速失败策略**：未配置 `IMS_DB_MODE=sqlite-seed` 且未配置 SQL Server 环境变量时，IMS 写/读接口按设计返回 `500 / 50000`，不做静默降级缓存。
- **跨库盘点双写顺序**：固定为先写 `SaleData.dbo.StocktakeLine`，再立即回写 `SKLAD.dbo.g1.Surplus`（与可选 `WarningAt`）；若第二步失败明确报错，支持重扫同一条码幂等覆盖修复。
- **无乐观锁与批量改价部分成功**：商品行内编辑遵循后提交覆盖（Last-Write-Wins）；批量改价逐行更新、每请求上限 500 条码，返回实际更新 `affected`。
