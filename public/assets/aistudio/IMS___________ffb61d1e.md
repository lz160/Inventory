# 库存 / 盘点 / 销售分析 三模块移植实现提示词

> **本文用途**：这是一份可直接交给实现方（AI 编码 Agent 或工程师）的完整任务书。它同时是规格、验收标准和验收测试来源。
> **使用方式**：先回答 §2 的全部 `【待确认-Qn】`（**未答复前不得开工**），再按 §4–§8 实现，最后按 §9–§10 交付与验收。
> **等价判定标准**：**输入相同 → 输出与副作用相同**，包括字段名、排序、分页边界、四舍五入、错误码、写库时机。不要求技术栈相同，但要求行为相同。

---

## 1. 角色与目标

**你的角色**：资深全栈工程师，负责把一套已在生产运行的库存管理系统（下称 IMS）中的三个模块移植到**目标软件**中。

**三个模块**：
| 编号 | 模块 | 一句话定义 |
|---|---|---|
| M1 | 库存 | 商品主数据的增删改查 + 列表筛选 + 批量改价 + 低库存告警；**写商品主表** |
| M2 | 销售分析 | 基于 POS 销售流水的汇总/时序/Top/滞销/毛利/补货建议/品类归类；**只读** |
| M3 | 盘点 | 实物清点：扫码录实盘数 → 与系统库存算差异 → **直接回写商品主表库存与警戒线** → 差异报告 |

**移植优先级**：M1 → M3 → M2（M3 依赖 M1 的库存读写能力；M2 独立但依赖销售流水表就绪）。

**明确不做的事**（除非 §2 另行确认）：进货单核对工作台（模块三原系统）、多店汇总、价格历史定时比对、低库存邮件通知、账户/权限管理、多语言框架本身。这些不在本次范围。

---

## 2. 开工前必须回答的问题（BLOCKING）

> 以下每一项缺失都**不允许自行假设**。请在开工前逐项书面答复；答复前最多只能做只读调研（读表结构、读现有代码），不得写业务代码。

### 2.1 目标环境（必须答复）

| 编号 | 问题 | 为什么必须先问 |
|---|---|---|
| `【待确认-Q1】` | 目标软件的后端技术栈是什么？（语言、框架、版本；是否允许 Node.js / Python / .NET / Java） | 决定连接池、事务、ORM 方案，完全改变实现形态 |
| `【待确认-Q2】` | 目标软件的**数据库类型与版本**？是否仍直连 SQL Server 的 `SKLAD.dbo.g1`，还是改为目标软件自己的库（MySQL/PostgreSQL/SQLite）？ | 移植是"换壳"还是"换存储"是两条完全不同的路线 |
| `【待确认-Q3】` | 若目标库不是原库：**现有表结构**请提供 DDL（至少商品表、销售流水表）。若沿用原库：请确认 `g1` 仍是 32 字段同名同类型、`Barcode` 仍唯一 | §4.1/§5.1 的全部字段映射以此为准 |
| `【待确认-Q4】` | 销售流水表结构是否与原系统一致？原结构为 `SalesLogDetail(LogId, Barcode, Delta, Cena, ...)` + `SalesLog(LogId, ChangeTime, AppName)`，其中 **`Delta = NewSurplus − OldSurplus`，负值代表卖出**。若目标库语义不同（例如存正数销量、或叫 `qty/price/sold_at`），请给出映射关系 | 销量/销售额口径的唯一定义源 |
| `【待确认-Q5】` | 是否多店铺？原系统按 `StoreId` 隔离，所有查询都带店铺维度。单店可否**直接去掉**店铺维度，还是要求保留字段以备将来？ | 影响每张表、每个查询、每个索引 |
| `【待确认-Q6】` | 权限体系是否已存在？原系统需要以下三项能力：`inventory.view`（看库存）、`inventory.edit`（改库存/盘点）、`product.create`（新建商品）、`sales.view`（看销售）。若目标软件已有角色体系，请给出能力名映射；若没有，请确认"全部登录用户均可访问"是否可接受 | 决定是否需要在接口层加鉴权 |
| `【待确认-Q7】` | 时区与货币？原系统：时区 `Europe/Bratislava`（含夏令时），货币 **EUR**，售价 `Cena` **含增值税 23%**，进货价 `Cena2` **不含税** | 日期分组、日界切分、毛利公式全部依赖它 |
| `【待确认-Q8】` | 目标软件界面语言？原系统为斯洛伐克语 `sk` + 中文 `zh` 双语，商品名不翻译 | 影响文案表与字段选择 |
| `【待确认-Q9】` | 数量与金额的精度约定：原系统数量为 `REAL`（单精度浮点），金额为 `MONEY`（4 位小数），展示层数量保留 2 位小数、金额格式化为 EUR 两位 | 四舍五入与对账差异会因此产生 0.01 级偏差 |
| `【待确认-Q10】` | 部署与网络：目标软件是否也通过 VPN/内网访问数据库？连接是否启用 TLS（原系统 `encrypt=false`，因为走内网隧道）？ | 决定连接字符串与超时策略 |

### 2.2 功能范围（必须答复）

| 编号 | 问题 | 备选 |
|---|---|---|
| `【待确认-Q11】` | M2 的**品类归类**子功能是否在移植范围内？它依赖两张附加表（`categories`、`product_meta`）和一套品名关键词规则。若目标软件已有商品分类字段，应改为直接使用该字段 | 需要 / 不需要 / 用目标软件的现有分类字段替代 |
| `【待确认-Q12】` | 是否需要移植"数据库断链时降级读本地镜像"的能力？原系统有一套 SQLite 镜像库，门店库不可达时只读降级、写入快速失败 | 需要 / 不需要 |
| `【待确认-Q13】` | M3 的盘点是否保留"**录行时立即回写库存**"的行为？原系统为了让盘点期间继续营业（边盘边销），每录一行就立即把实盘数写回商品主表，而不是提交时批量写 | 保留 / 改为提交时统一写（两种行为的验收标准不同） |
| `【待确认-Q14】` | M1 的"批量改价"是否保留？原系统支持按筛选条件或勾选行批量改售价/进货价，且**禁止无条件全表改价** | 保留 / 去掉 |
| `【待确认-Q15】` | 导出功能（库存清单 XLSX、盘点差异 XLSX、销售分析 XLSX）是否在范围内？原系统四类导出，本次只涉及其中三类 | 全做 / 只做盘点差异 / 不做 |

### 2.3 交付与验收（必须答复）

| 编号 | 问题 |
|---|---|
| `【待确认-Q16】` | 交付物落在哪个仓库/目录？是否要求附带数据库迁移脚本与种子数据？ |
| `【待确认-Q17】` | 是否有可用的测试数据库（含脱敏样例数据）？没有的话，是否接受用 3–5 条构造数据做验收（见 §10.4）？ |
| `【待确认-Q18】` | 验收由谁执行、以什么为准？本文 §4.7/§5.6/§6.6 的 AC 编号是否可直接作为验收清单？ |

> **实现方义务**：以上问题若在实现过程中才暴露，必须**停下来提问**，不得用"合理默认值"补齐后继续。任何自行假设的实现都会被退回。

---

## 3. 源系统事实（作为验收基准，不得改动语义）

### 3.1 拓扑与技术栈
| 层 | 原实现 |
|---|---|
| 后端 | Node.js 20 + Express 4（CommonJS），驱动 `mssql`（tedious，纯 JS） |
| 前端 | Vue 3 + Vite + Tailwind v4 + Pinia + vue-router + axios + chart.js + vue-i18n(sk/zh) |
| 用户/配置库 | SQLite（`better-sqlite3`），存用户、店铺注册表、权限矩阵、商品分类元数据 |
| 业务数据库 | SQL Server：`SKLAD`（商品主表 `g1`，读写）+ `SaleData`（销售流水，只读；另建盘点/价格历史表） |
| 网络 | 服务部署在公网主机，经宿主机 WireGuard 隧道访问内网 `10.8.0.4:1433` |
| 两个数据库账号 | `SKLAD` 用高权限账号（可写 `g1`）；`SaleData` 用专用账号（读销售 + 只能在该库建表） |

### 3.2 三层结构（移植时建议保留同样的分层，便于对照验收）
```
路由层 routes/          → 只做参数校验 + 权限 + 调用适配器 + 统一响应
适配器层 adapters/      → 所有 SQL 集中在此；可换实现（真实库 / 本地镜像）
数据访问层 db/          → 连接池管理、建表 DDL、事务
```
**硬性要求**：业务代码中**不得出现任何 SQL 字符串拼接**，所有值必须参数化绑定。

### 3.3 统一响应信封与错误码（必须一致）
成功：
```json
{ "code": 0, "data": <payload>, "message": "" }
```
失败：
```json
{ "code": 40901, "message": "条码 1234567890123 已存在，新建被拒绝（不覆盖已有行）" }
```
| HTTP | 业务码 | 语义 | 触发场景 |
|---|---|---|---|
| 401 | `40001` | 未登录/登录过期 | 无 token 或 token 失效 |
| 403 | `40003` | 无权限 / 越店铺 | 缺能力，或访问未授权店铺 |
| 404 | `40404` | 资源不存在 | 条码/盘点单不存在 |
| 409 | `40901` | 条码重复 | 新建商品条码已存在 |
| 422 | `42201` | 参数校验失败 | 数量为负、日期格式错、批量改价无条件等 |
| 500 | `50000` | 服务器错误 | 未捕获异常 |
| 501 | `50101` | 未实现 | 适配器占位抛出 |

> 目标软件若已有错误码体系，必须提供**双向映射表**（原码 ↔ 新码），并保证 §10 的验收用例仍能区分上述 7 类错误。

---

## 4. 模块一：库存（M1）

### 4.1 数据表结构

#### 4.1.1 商品主表 `g1`（SQL Server `SKLAD.dbo.g1`，32 字段，实测 33,598 行）
| # | 字段 | 原类型 | 角色 | 新建默认值 | 说明 |
|---|---|---|---|---|---|
| 1 | `Nazov` | nvarchar(510) | **必填** | `''` | 商品名称 |
| 2 | `Cena` | money | 读写 | `0` | **售价，含 VAT 23%** |
| 3 | `PovCena` | money | 读写 | `0` | 最高限价/允许价，业务未用 |
| 4 | `Barcode` | varchar(13) | **主键/唯一** | 必填 | **唯一匹配键**，33,598/33,598 唯一；查询必须 `TRIM()` 后精确等值 |
| 5 | `Mnozstvo` | real | 读写 | `0` | 用户说明"暂无用"，新建恒 0 |
| 6 | `Kod` | nvarchar(510) | 读写 | `''` | 货号，**非唯一**（27,276 不重复），仅作 T1 搜索 |
| 7 | `Element` | nvarchar(max) | 读写 | `''` | 长文本，未用 |
| 8 | `Class` | varchar(5) | 读写 | `''` | 分类字段，33,536 行为空，实际未用 |
| 9 | `Reserved` | bit | 读写 | `0` | 预留标记 |
| 10 | `Surplus` | real | 读写 | `0` | **可售库存（唯一库存口径）** |
| 11 | `VIPnoDiscount` | bit | 读写 | `0` | VIP 不打折 |
| 12 | `barcode2nd` | varchar(13) | 读写 | `''` | 第二条码 |
| 13 | `conv2ndtobarcode` | int | 读写 | `0` | 第二码售出时扣减的库存数（换算率） |
| 14 | `barcodeType` | int | 读写 | `0` | 条码类型 |
| 15 | `DPHtype` | int | 读写 | `1` | 税率类型（常量 1） |
| 16 | `PurchasePrice` | money | 读写 | `0` | 进货成本，v1 不参与比价 |
| 17 | `Dozen` | int | 读写 | `0` | 按打 |
| 18 | `Box` | int | 读写 | `0` | 按箱 |
| 19 | `menupackage` | nvarchar(510) | 读写 | `''` | 套餐包 |
| 20 | `Picture` | nvarchar(510) | 读写 | `''` | 图片路径 |
| 21 | `Cena2` | money | 读写 | `0` | **进货价，不含税** |
| 22 | `WarningAt` | smallint | **仅盘点可写** | `0` | 低库存警戒线；**普通编辑不得暴露** |
| 23 | `MoreSurplus` | nvarchar(2000) | 读写 | `''` | 溢出备注 |
| 24 | `ExpiryDate` | nvarchar(510) | 读写 | `NULL` | 到期日 |
| 25 | `PurchaseCountry` | nvarchar(510) | 读写 | `''` | 采购国 |
| 26 | `Supplier` | nvarchar(510) | 读写 | `''` | 供应商 |
| 27 | `Companions` | nvarchar(510) | 读写 | `''` | 关联商品 |
| 28 | `NotNewForCloud` | bit | 读写 | `1` | 云同步标记 |
| 29 | `IsUpdateCloud` | bit | 读写 | `0` | 云更新标记 |
| 30 | `InstallDate` | datetime | **系统写** | 建档时刻 | 建档时间，不接受用户输入 |
| 31 | `Shelves` | float | 读写 | `NULL` | 货架位 |
| 32 | `LastInstallQty` | float | 读写 | `0` | 上次到货量 |

**字段可写性三分类（必须严格实现，不得放宽）**：
- **可编辑白名单** = 32 字段 − `Barcode`（主键）− `WarningAt`（盘点专属）− `InstallDate`（系统写）= **29 个字段**
- **仅盘点可写**：`WarningAt`
- **系统写**：`Barcode` 仅新建时可指定，之后不可改；`InstallDate` 写入时取当前时刻

#### 4.1.2 价格历史表 `PriceHistory`（售价/进货价变更轨迹）
```sql
CREATE TABLE PriceHistory (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  StoreId   INT NOT NULL,              -- 单店部署时可去掉
  Barcode   VARCHAR(13) NOT NULL,
  Nazov     NVARCHAR(510) NULL,
  Field     NVARCHAR(10) NOT NULL,     -- 'Cena' | 'Cena2'
  OldValue  MONEY NULL,                -- 新建基线时为 NULL
  NewValue  MONEY NULL,
  ChangedBy NVARCHAR(100) NOT NULL,    -- 操作人用户名；定时任务为 'system'
  ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  Source    NVARCHAR(10) NOT NULL      -- 'ims' | 'scheduled'
);
CREATE INDEX IX_PriceHistory_StoreBarcodeField ON PriceHistory(StoreId, Barcode, Field, Id DESC);
```
**写入时机（M1 内）**：
1. 新建商品：为 `Cena`、`Cena2` 各写一条基线（`OldValue = NULL`, `Source='ims'`）。
2. 行内编辑：仅当 `Cena` 或 `Cena2` 的**数值真的变了**才写。
3. 批量改价：逐行写，同样只在数值变化时写。
4. **价格历史写入失败不得阻断主流程**（原实现 try/catch 后仅记日志）。

### 4.2 业务规则

#### R-INV-1 列表与搜索（多条件可组合，全部 AND）
| 参数 | 语义 | SQL 形态 |
|---|---|---|
| `barcode` | **T0 精确** | `TRIM(Barcode) = @barcode` |
| `kod` | T1 模糊 | `Kod LIKE '%@kod%'` |
| `q` | 综合模糊：条码/货号/品名/供应商任一命中 | `(TRIM(Barcode) LIKE @q OR Kod LIKE @q OR Nazov LIKE @q OR Supplier LIKE @q)`，`@q` 前后加 `%` |
| `supplier` | 精确 | `TRIM(Supplier) = @supplier` |
| `stock` | 库存状态三等分（见下） | 见下 |

**库存状态判定（唯一定义，前后端必须一致）**：
```
out（缺货）: Surplus <= 0
low（低库存）: WarningAt > 0 AND Surplus <= WarningAt AND Surplus > 0
in （有货）: Surplus > 0 AND NOT (WarningAt > 0 AND Surplus <= WarningAt)
```
> 注意 `low` 包含 `Surplus > 0` 条件，因此 `low` 与 `out` 互斥；`in` 是 `out ∪ low` 的补集。

**排序**：只允许白名单列 `Barcode, Nazov, Kod, Cena, Cena2, Surplus, Supplier, WarningAt`；方向仅 `asc|desc`；非白名单输入回退 `Barcode asc`。**排序必须追加 `Barcode` 作为稳定次序键**（`ORDER BY <col> <dir>, Barcode ASC`），否则分页会重复/遗漏。

**分页**：`page ≥ 1`（默认 1），`pageSize ∈ [1,200]`（默认 20，超界截断不报错）。必须返回 `total`（不受分页影响的总行数）。

#### R-INV-2 单条查询
按 `Barcode` 精确查；未命中返回 `null` → 路由层转 `404/40404`，消息 `条码 {barcode} 的商品不存在`。

#### R-INV-3 新建商品
1. 校验：`Nazov` 非空（trim 后）、`Barcode` 非空（trim 后）、`Barcode` 长度 ≤ 13。
2. **查重**：`SELECT COUNT(*) FROM g1 WHERE TRIM(Barcode)=@bc`，`>0` 即抛 `409/40901`，**绝不覆盖已有行**。
3. 组装：先取 32 字段默认值，再用请求体覆盖；强制 `Barcode=规范化值`、`Nazov=trim 后值`、`InstallDate=当前时刻`。
4. `INSERT` 全部 32 列（显式列名 + 参数化，不依赖列顺序）。
5. 写两条价格基线（失败忽略）。
6. 返回新建后的完整行（重新 SELECT）。

**新建表单暴露的字段（其余取默认值）**：
- 必填：`Nazov`、`Barcode`
- 选填：`Cena`、`Kod`、`Surplus`、`Cena2`、`Supplier`、`barcode2nd`、`conv2ndtobarcode`（后两个默认折叠/隐藏）

#### R-INV-4 行内编辑
1. 先取 before 快照，不存在 → `404`。
2. 用白名单过滤 patch（29 字段）；过滤后为空 → `422`，消息 `没有可更新的字段（WarningAt 请在盘点模块修改）`。
3. 类型转换：14 个数值字段转数字（`Cena, PovCena, Mnozstvo, Surplus, conv2ndtobarcode, barcodeType, DPHtype, PurchasePrice, Dozen, Box, Cena2, WarningAt, Shelves, LastInstallQty`）；4 个 bit 字段转 `0/1`（`Reserved, VIPnoDiscount, NotNewForCloud, IsUpdateCloud`）。
4. 动态 `UPDATE dbo.g1 SET <col>=@v, ... WHERE TRIM(Barcode)=@bc`，每个字段按元数据类型绑定。
5. 价格变动写历史（对 `Cena`/`Cena2` 各判断一次）。
6. 返回 `{ before, after }`；路由层只回 `after`。

#### R-INV-5 批量改价
- 只允许改 `Cena`、`Cena2` 两个字段；两者都为空的请求 → `422`。
- 目标行两种圈定方式：
  - `barcodes` 数组：上限 500 个；`WHERE TRIM(Barcode) IN (...)` 参数化。
  - 筛选条件：**必须至少有一个筛选条件**，否则 `422`（消息含"禁止全表改价"）。
- 逐行 `UPDATE`，每行独立写价格历史；返回 `{ affected }`（受影响行数合计）。

#### R-INV-6 删除商品
按 `Barcode` 删除；`rowsAffected = 0` → `404`。前端必须二次确认（弹窗写明商品名）。

#### R-INV-7 供应商下拉
`SELECT DISTINCT TRIM(Supplier) FROM g1 WHERE TRIM(Supplier) <> '' ORDER BY supplier`，**限 300 条**。

#### R-INV-8 低库存列表
```sql
SELECT ... FROM g1
WHERE WarningAt > 0 AND Surplus <= WarningAt
ORDER BY (WarningAt - Surplus) DESC, Barcode ASC
```
每行附加计算列 `Gap = WarningAt - Surplus`。总计行数即返回行数。

### 4.3 接口契约（M1）

| # | 方法 | 路径 | 能力 | 关键入参 | 返回 `data` |
|---|---|---|---|---|---|
| 1 | GET | `/api/g1/products` | `inventory.view` | `barcode,kod,q,supplier,stock,page,pageSize,sortBy,sortDir` | `{ rows: Product[], total: number }` |
| 2 | GET | `/api/g1/products/:barcode` | `inventory.view` | — | `Product` |
| 3 | POST | `/api/g1/products` | `product.create` | Body: 见 R-INV-3 | `Product` |
| 4 | PATCH | `/api/g1/products/:barcode` | `inventory.edit` | Body: 白名单字段 | `Product`（after） |
| 5 | DELETE | `/api/g1/products/:barcode` | `inventory.edit` | — | `{ deleted: true }` |
| 6 | POST | `/api/g1/batch-price` | `inventory.edit` | `{ filter: {...}, patch: { Cena?, Cena2? } }` | `{ affected: number }` |
| 7 | GET | `/api/g1/suppliers` | `inventory.view` | — | `string[]` |
| 8 | GET | `/api/g1/low-stock` | `alert.view` | — | `{ rows: (Product & {Gap})[], total }` |

**`Product` 对象形状**：`g1` 的 32 个字段**原样 PascalCase 透传**（`Barcode`、`Nazov`、`Cena`、`Cena2`、`Surplus`、`WarningAt`、`Kod`、`Supplier`、`barcode2nd`、`conv2ndtobarcode` …）。**不要改成 camelCase**——前后端字段名一致是原系统的既定契约；若目标软件强制 camelCase，必须提供映射层并在接口文档中列全 32 条映射。

### 4.4 计算规则
| 规则 | 公式 | 备注 |
|---|---|---|
| 库存状态 | 见 R-INV-1 | 三态：`in / low / out` |
| 毛利额（含 VAT） | `Cena − Cena2` | `Cena` 含税、`Cena2` 不含税，故此口径是"混合口径"，仅作参考展示 |
| 净售价 | `Cena / 1.23` | VAT 23% |
| 毛利额（净） | `Cena/1.23 − Cena2` | |
| 净毛利率 | `(Cena/1.23 − Cena2) / (Cena/1.23)` | 分母为 0 时返回空值，不显示 `Infinity` |
| 展示精度 | 数量最多 2 位小数；金额 EUR 2 位；百分比 1 位 | 计算用原始精度，仅展示层舍入 |

### 4.5 页面交互要求
1. **列表页**：表格列 = 条码 / 品名 / 库存(`Surplus`) / 售价(`Cena`) / 品类 / 状态徽章；状态徽章必须**图标 + 文字**（不允许只用颜色）；`low` 行整行浅黄底。
2. **筛选区**：综合搜索框（回车触发）、供应商下拉、库存状态下拉（全部/有货/低库存/缺货）、重置按钮；筛选变更后回到第 1 页。
3. **行点击** → 打开编辑弹窗；弹窗字段 = `Nazov, Kod, Surplus, Cena, Cena2, Supplier, barcode2nd, conv2ndtobarcode` + 品类；`Barcode` 只读展示；底部按钮 = 删除（左）/ 取消 / 保存。
4. **保存行为**：先 `PATCH` 商品字段，再**异步**保存品类（失败不阻断保存，仅不显示品类）；成功后 toast 提示并刷新列表。
5. **删除**：编辑弹窗内点删除 → 二次确认弹窗（显示商品名）→ 确认后删除并刷新。
6. **新建**：抽屉/弹窗表单，仅 7 个字段；条码重复时**保持弹窗打开**并把错误显示在条码字段下方（`40901` 单独处理，不弹通用 toast）。
7. **批量改价**：范围二选一（当前筛选 / 已勾选 N 行，未勾选时禁用后者）；可只填任一价格；确认后提示 "已更新 N 行"。
8. **权限**：无 `inventory.edit` 时隐藏编辑/删除/批量改价入口；无 `product.create` 时隐藏新建按钮（后端仍必须鉴权）。
9. **分页**：显示总数、页码、每页 20/50/100 可切换。
10. **空态**：无数据显示明确空态文案，不留白屏。

### 4.6 M1 验收标准
| 编号 | 验收项 | 通过判据 |
|---|---|---|
| `AC-INV-01` | 列表分页稳定 | 同一筛选条件下翻页，两页无重复条码、无遗漏；`total` 与逐页累加一致 |
| `AC-INV-02` | 精确 vs 模糊 | `barcode=123` 只命中条码完全等于 `123` 的行；`q=123` 可命中条码/货号/品名/供应商包含 `123` 的行 |
| `AC-INV-03` | 库存三态互斥 | 对 `Surplus=-1/0/3`、`WarningAt=0/5` 的 6 种组合，状态判定与 R-INV-1 完全一致，无一行同时满足两态 |
| `AC-INV-04` | 新建查重 | 用已存在条码新建 → HTTP 409 + 业务码 40901，且原行**未被修改** |
| `AC-INV-05` | 新建默认值 | 仅填品名+条码新建 → 落库 `Cena=0, Cena2=0, Surplus=0, DPHtype=1, NotNewForCloud=1, InstallDate≈当前时刻` |
| `AC-INV-06` | 编辑白名单 | PATCH 只传 `{WarningAt: 5}` → 422 且库中 `WarningAt` 未变；只传 `{Barcode:'x'}` → 422 |
| `AC-INV-07` | 编辑落库 | PATCH `{Nazov, Cena}` → 库中两字段更新，且 `PriceHistory` 新增一条 `Field='Cena', OldValue=旧值, NewValue=新值, Source='ims'` |
| `AC-INV-08` | 未变不写历史 | PATCH `{Cena: <与原值相同>}` → 不产生价格历史行 |
| `AC-INV-09` | 批量改价保护 | `POST /batch-price` 传空 filter 与空 barcodes → 422；传 501 个 barcodes → 拒绝或截断且行为在文档中写明 |
| `AC-INV-10` | 批量改价生效 | 按供应商筛选改价 → 该供应商全部行价格变更，其他供应商不受影响，`affected` 与变更行数一致 |
| `AC-INV-11` | 低库存口径 | 造 `Surplus=2, WarningAt=5` 与 `Surplus=9, WarningAt=5` 两行 → 前者出现在低库存列表（`Gap=3`），后者不出现 |
| `AC-INV-12` | 供应商去重 | 库中 3 行同供应商 → 下拉只出现 1 条，且按字母序 |
| `AC-INV-13` | 权限 | 用无 `inventory.edit` 的账号调 PATCH → 403/40003，库中数据不变 |
| `AC-INV-14` | 删除确认 | 前端必须二次确认；后端直接调用可删（二次确认是前端职责，需在文档中写明） |

---

## 5. 模块二：销售分析（M2）

### 5.1 数据源与口径（最关键，错一处全盘错）

**源表**（SQL Server `SaleData`）：
```sql
-- 销售日志头
SalesLog(LogId, ChangeTime, AppName, ...)
-- 销售日志明细
SalesLogDetail(LogId, Barcode, Nazov, Delta, Cena, Supplier, ...)
```
**关联与过滤（必须逐条实现）**：
```sql
FROM SalesLogDetail d
JOIN SalesLog l ON l.LogId = d.LogId
WHERE d.Delta < 0                                  -- ① 只取卖出（Delta 为负）
  AND l.AppName NOT IN ('Tedious','node-mssql')     -- ② 排除 IMS 自己改库存产生的日志
  [AND l.ChangeTime >= @from]                       -- ③ from 当天 00:00:00
  [AND l.ChangeTime <= @to]                         -- ④ to 当天 23:59:59
  [AND TRIM(d.Barcode) = @barcode]                  -- ⑤ 可选：单商品过滤
```
**公式**：
```
销量   SoldQty  = -d.Delta
销售额 Revenue  = -d.Delta * d.Cena
```
> ⚠️ **`Delta` 语义是"库存变化量"，不是"销量"**：`Delta = NewSurplus − OldSurplus`，卖出为负、入库/调库为正。若目标系统流水表存的是正数销量，映射必须在适配层完成，**不得在 UI 层取反**。

**必须记录的已知数据现象**（不作为 bug，但要在验收里体现）：部分销售行 `Cena = 0`（生产实测约 20.5% 的销量），这些行贡献销量但贡献 0 销售额；统计时不得把它们当作"数据错误"过滤掉。

### 5.2 接口契约（M2）

| # | 方法 | 路径 | 能力 | 入参 | 返回 `data` |
|---|---|---|---|---|---|
| 1 | GET | `/api/sales/summary` | `sales.view` | `from?,to?,barcode?` | `{ totalQty, totalRevenue, from, to }` |
| 2 | GET | `/api/sales/timeseries` | `sales.view` | `from?,to?,barcode?,granularity=day\|week\|month` | `{ granularity, rows: [{ period, qty, revenue }] }` |
| 3 | GET | `/api/sales/top` | `sales.view` | `from?,to?,barcode?,limit` (1–200，默认 20) | `{ rows: SoldRow[] }` |
| 4 | GET | `/api/sales/slow` | `sales.view` | 同上 | `{ rows: SoldRow[] }` |
| 5 | GET | `/api/sales/margin` | `sales.view` | `limit` (默认 50) | `{ rows: SoldRow[] }`（与 top 同源，毛利前端算） |
| 6 | GET | `/api/sales/restock` | `sales.view` | `days` (1–365，默认 30), `limit` | `{ days, rows: RestockRow[] }` |
| 7 | GET | `/api/sales/by-category` | `sales.view` | `from?,to?,barcode?` | `{ rows: CategoryRow[], total: {...} }`（仅当 Q11 含品类时） |
| 8 | GET | `/api/sales/uncategorized` | `sales.view` | `from?,to?,limit` (≤500) | `{ rows: UncatRow[], total, withSuggestion, suggestTotal }` |
| 9 | POST | `/api/sales/auto-categorize` | `sales.view` | `{ items: [{barcode, category}] }`（≤500） | `{ applied }` |

**`SoldRow`**：`{ Barcode, Nazov, SoldQty, Revenue, Cena, Cena2, Surplus }`
> `Nazov/Cena/Cena2/Surplus` 来自商品主表 `g1` 的补全（销售流水里的 `Nazov` 可能过期），补不到的字段返回 `null`，**不得用空字符串冒充**。

**`RestockRow`**：`{ Barcode, Nazov, Surplus, WarningAt, Cena, Cena2, SoldQty, DailyRate, DaysLeft, SuggestedQty }`

**`CategoryRow`**：`{ code, name_sk, name_zh, skuCount, qty, revenue, qtyShare, revenueShare, averagePrice }`
**`total`**：`{ qty, revenue, skuCount, categoryCount, uncategorized: { skuCount, qty, revenue, revenueShare, skuShare } }`

### 5.3 计算规则
| 指标 | 规则 |
|---|---|
| 汇总 | `totalQty = Σ SoldQty`、`totalRevenue = Σ Revenue`；区间无数据返回 `0` 而非 `null` |
| 时序 `period` 格式 | 日：`YYYY-MM-DD`；周：`YYYY-Www`（**ISO 8601 周**，周一为第一天，跨年按 ISO 年）；月：`YYYY-MM`；按 `period` 升序 |
| 时序分组时区 | **必须按目标业务时区的本地日切分**（原实现直接对 UTC 时间戳截断，存在跨时区偏移风险 → 见 `§8` 边界 B-13，需按 Q7 确认后定稿） |
| Top | 按 `SoldQty` 降序；`limit` 越界截断到 `[1,200]`，不报错 |
| Slow（滞销） | 取**全部库存 > 0 的商品**（`Surplus > 0`），左连销售聚合，无销售记 `SoldQty=0`；排序 `SoldQty asc, Surplus desc`；再截 `limit` |
| 毛利率 | 同 M1 计算规则（含 VAT 与净两口径） |
| 日均销量 | `DailyRate = SoldQty / days`，保留 3 位小数 |
| 可售天数 | `DaysLeft = Surplus / DailyRate`；`DailyRate = 0` 时为 `null`（前端显示 `∞`），保留 1 位小数 |
| 建议补货 | `SuggestedQty = max(0, ceil(DailyRate * 30 − Surplus))`（固定按 30 天备货，与 `days` 参数无关） |
| 补货排序 | `DaysLeft asc`（`null` 视为无穷大排最后） |
| 品类占比 | `revenueShare = 该品类 revenue / 总 revenue`；`qtyShare = 该品类 qty / 总 qty`；分母 0 时返回 0 |
| 未归类桶 | 无品类的商品统一进 `code = '__uncat__'` 桶，**固定排在最后**，前端用警示色单独标注 |

**品类归类规则（若 Q11 = 需要）**：
- 依据商品名关键词匹配，先归一化（小写 + 去变音符号 + 压缩空白），再按规则表**从上到下取第一条命中**；不命中返回 `null`（宁可留空，不猜）。
- 服饰类需叠加性别/年龄前缀：`damske|damska|damsky|dam|zena|zensk|女` → `w_`；`panske|panska|pansky|男` → `m_`；`detske|detska|detsky|chlapcensk|kids|童|儿童` → `kid`；无性别 → 通用码。
- 品类字典共 77+ 项（`categories: code, name_sk, name_zh, sort_order`），`product_meta: barcode PK, category FK, name_zh, updated_by, updated_at`。
- 归类结果**只能由用户确认后写入**（`auto-categorize` 是显式提交），不得在读取路径上"顺手写库"。

### 5.4 页面交互要求
1. **筛选区**：开始日期、结束日期、粒度（日/周/月）、单商品搜索（条码或品名，回车触发）、清除按钮。默认区间 = 最近 30 天。
2. **汇总卡**：销量、销售额（EUR）、统计区间三块；数字统一 tabular-nums 等宽对齐。
3. **时序图**：折线图，X 轴为 `period`，Y 轴为销量；区间无数据时显示空态而非空图。
4. **页签**：`品类汇总 | Top 销量 | 滞销商品 | 补货建议`（品类页签仅在 Q11=需要时出现，且可作为默认页签）。
5. **Top/滞销表格**：条码、品名、销量、库存；销量右对齐。
6. **补货表格**：库存、日均销量、可售天数、建议补货；`DaysLeft < 7` 用警示色；`DaysLeft = null` 显示 `∞`。
7. **品类表格**：品类名、SKU 数、销量、销售额、占比（进度条 + 百分比）；底部合计行；未归类行高亮。
8. **智能归类面板**：列出未归类商品（条码/品名/销量/销售额/建议品类），仅"有建议"的行可勾选，默认全选有建议行；顶部显示"本页 N 条、其中 M 条可自动判断（全店共 T 条）"；确认按钮显示待写入条数；写入成功后关闭面板并刷新汇总。
9. **空态/错误**：接口失败用 toast 提示且保留上一屏数据，不清空。

### 5.5 M2 验收标准
| 编号 | 验收项 | 通过判据 |
|---|---|---|
| `AC-SAL-01` | Delta 口径 | 手工构造 1 条 `Delta=-3, Cena=10` 与 1 条 `Delta=+5, Cena=10` 的日志 → 汇总为 `qty=3, revenue=30`（入库行不计入） |
| `AC-SAL-02` | 排除内部写入 | 构造 `AppName='Tedious'` 的 `Delta=-2` 行 → 不进任何统计 |
| `AC-SAL-03` | 区间闭区间 | 边界日 00:00:00 与 23:59:59 的记录都被包含；次日 00:00:00 不被包含 |
| `AC-SAL-04` | 时序格式 | `granularity=week` 返回形如 `2026-W34`，且 2026-12-28（周一）落在次年 ISO 周（如 `2027-W01`）时归属正确 |
| `AC-SAL-05` | Top 排序与上限 | `limit=1000` 请求被截断到 200 且不报错；返回行按 `SoldQty` 严格降序 |
| `AC-SAL-06` | 滞销含零销量 | 有库存但区间内零销量的商品必须出现在滞销列表首部（`SoldQty=0`） |
| `AC-SAL-07` | 补货公式 | `Surplus=10, days=30, SoldQty=60` → `DailyRate=2, DaysLeft=5, SuggestedQty=50` |
| `AC-SAL-08` | 零日均 | `SoldQty=0` 的商品 → `DaysLeft=null`，前端显示 `∞`，且排在列表末尾 |
| `AC-SAL-09` | 毛利函数 | `Cena=123, Cena2=80` → 毛利(含VAT)=43、净售价=100、毛利(净)=20、净毛利率=20.0% |
| `AC-SAL-10` | 除零保护 | `Cena=0` → 净毛利率返回空值（显示 `—`），不出现 `Infinity`/`NaN` |
| `AC-SAL-11` | 品类占比自洽 | 各品类 `revenueShare` 之和 = 1（±0.0001）；`Σ revenue` 与 `/summary` 的 `totalRevenue` 一致 |
| `AC-SAL-12` | 未归类位置 | `__uncat__` 恒在列表最后一行，即使其金额最大 |
| `AC-SAL-13` | 品类写入可控 | 未点"确认归类"前，`product_meta` 不得有任何新增/变更 |
| `AC-SAL-14` | 空区间 | 查询未来区间 → 全部返回 0/空数组，不报 500 |

---

## 6. 模块三：盘点（M3）

### 6.1 数据表结构（与原系统一致；单店部署可去掉 `StoreId`）

```sql
CREATE TABLE Stocktake (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  StoreId     INT NOT NULL,                     -- 单店可去掉
  Name        NVARCHAR(200) NOT NULL,
  CountDate   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CreatedBy   NVARCHAR(100) NOT NULL,
  Status      NVARCHAR(20) NOT NULL DEFAULT 'open',   -- open | submitted
  SyncedToG1  DATETIME2 NULL                    -- 提交时间（追溯用）
);

CREATE TABLE StocktakeLine (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  StocktakeId INT NOT NULL REFERENCES Stocktake(Id),
  Barcode     VARCHAR(13) NOT NULL,
  Nazov       NVARCHAR(510) NULL,
  SystemQty   REAL NULL,      -- 录行时刻 g1.Surplus 的快照
  CountedQty  REAL NULL,      -- 实盘数
  Variance    REAL NULL,      -- CountedQty - SystemQty
  WarningAt   REAL NULL,      -- 本次同时设置的警戒线（可空）
  Notes       NVARCHAR(1000) NULL
);

CREATE INDEX IX_StocktakeLine_Stocktake ON StocktakeLine(StocktakeId);
```
> `StocktakeLine` **不对 `Barcode` 建唯一约束**，但业务上用 `(StocktakeId, Barcode)` 做 upsert（重复扫码 = 覆盖同一行，不新增行）。

### 6.2 业务流程（必须按此顺序，含写库时机）

```
建单（Status=open）
   ↓
扫码输入条码 → 查 g1 取 Nazov 与当前 Surplus（作为 SystemQty 快照）
   ↓
输入 实盘数 CountedQty（必填、≥0）与 警戒线 WarningAt（可选、≥0）
   ↓
计算 Variance = CountedQty − SystemQty（前端先实时预览，后端二次计算为准）
   ↓
【写库①】upsert StocktakeLine（同条码重扫则覆盖该行）
   ↓
【写库②】立即 UPDATE g1 SET Surplus=CountedQty [, WarningAt=@warningAt] WHERE Barcode=@bc
   ↓  （此步是"边盘边销"的关键：录一行就生效一行）
重复以上直到清点完成
   ↓
提交（Status open → submitted，写 SyncedToG1=当前时间；不再写 g1，因为已逐行写过）
   ↓
差异报告（列表 → 详情：逐行 SystemQty / CountedQty / Variance）
```
> 若 Q13 改为"提交时统一写"，则流程变为：录行只写 `StocktakeLine`，提交时在一个事务内批量 `UPDATE g1`，并把验收用例 `AC-STK-04/05` 的判据同步替换（见 §6.6 备注）。

### 6.3 接口契约（M3）

| # | 方法 | 路径 | 能力 | 入参 | 返回 `data` |
|---|---|---|---|---|---|
| 1 | POST | `/api/stocktakes` | `inventory.edit` | `{ name? }` | 完整盘点单 + 空 `lines` |
| 2 | GET | `/api/stocktakes` | `inventory.edit` | — | `{ rows: [{...head, LineCount, DiffCount}] }` |
| 3 | GET | `/api/stocktakes/:id` | `inventory.edit` | — | `{ stocktake, lines }` |
| 4 | POST | `/api/stocktakes/:id/lines` | `inventory.edit` | `{ barcode, countedQty, warningAt?, notes? }` | `{ Barcode, Nazov, SystemQty, CountedQty, Variance, WarningAt }` |
| 5 | POST | `/api/stocktakes/:id/submit` | `inventory.edit` | — | 完整盘点单 |
| 6 | DELETE | `/api/stocktakes/:id` | `inventory.edit` | — | `{ deleted: id }` |

### 6.4 关键规则（逐条可测）
| 规则 | 内容 |
|---|---|
| 建单名称 | `name` 为空时自动生成 `盘点-YYYY-MM-DD`（服务器当天日期）；超长截断到 200 字符 |
| 状态机 | 仅 `open` 可录行；`submitted` 再录行 → `422`，消息 `盘点单已提交，不可再录行` |
| 录行-实盘数校验 | 必须是有限数字且 `≥ 0`；`NaN/Infinity/负数/非数字` → `422` |
| 录行-警戒线校验 | 可为空；非空必须是有限数字且 `≥ 0` → 否则 `422` |
| 录行-商品存在性 | 条码在本店商品表不存在 → `404`，消息 `条码 {bc} 的商品不存在于本店 g1` |
| `SystemQty` 取值时点 | **每次录行都重新读一次当前 `Surplus`**，不是建单时批量快照（因此同一条码第二次录行时 `SystemQty` 等于上次写入后的值） |
| 重复扫码 | 同 `(StocktakeId, Barcode)` 覆盖同一行：更新 `Nazov/SystemQty/CountedQty/Variance/WarningAt/Notes` |
| 提交前置条件 | `Status='open'` 且**至少 1 行**，否则 `422`（消息 `盘点单没有任何行，无法提交`） |
| 提交副作用 | 仅 `Status='submitted'` + `SyncedToG1=now`；**不批量回写 g1** |
| 删除 | 先删行再删头；**允许删除已提交单**（原系统如此，属高危，需要前端二次确认 → 见 `【待确认-Q19】`：是否允许删已提交单） |
| 并发 | 两人同时录同一单同一条码 → 后者覆盖前者（last-write-wins）；提交与录行并发时以 `Status` 检查为准 |

### 6.5 页面交互要求
1. **盘点主页面**：顶部盘点单信息（名称/日期/创建人/行数）、扫码输入框自动聚焦。
2. **命中预览**：扫到条码后先显示品名 + 当前系统库存，再让用户输入实盘数。
3. **实盘数输入**：大号数字输入框（手持设备友好），`Enter` 直接提交当前行；警戒线输入框并排。
4. **差异实时预览**：输入时立即显示 `+N / −N / 0`，0 为success色，非 0 为警示色。
5. **已盘点行列表**：每行显示差异徽标（`+N`/`-N`）、品名、条码、`系统数 → 实盘数`；可滚动。
6. **提交**：行数 > 0 才可提交；提交后页面转为只读并展示差异报告。
7. **删除**：二次确认，文案包含盘点单名称。
8. **差异报告**：列表页每行显示总行数/差异行数；详情页逐行显示三种数量与差异，支持导出（若 Q15 含导出）。

### 6.6 M3 验收标准
| 编号 | 验收项 | 通过判据 |
|---|---|---|
| `AC-STK-01` | 建单默认名 | 不传 name → 名称等于 `盘点-<服务器当天日期>` |
| `AC-STK-02` | 差异计算 | `SystemQty=10`，实盘 `7` → `Variance=-3`；实盘 `10` → `0`；实盘 `12` → `+2` |
| `AC-STK-03` | 负数拒绝 | `countedQty=-1` → 422，且 `StocktakeLine` 与 `g1` 均无变化 |
| `AC-STK-04` | 即时回写 | 录一行 `countedQty=7` 后立即查 `g1.Surplus` → 已变为 `7`（无需提交） |
| `AC-STK-05` | 警戒线同写 | 录行时传 `warningAt=5` → `g1.WarningAt=5`；不传则 `WarningAt` 保持原值不变 |
| `AC-STK-06` | 重扫覆盖 | 同条码录两次（7 再录 9）→ `StocktakeLine` 该条码**只有一行**，`CountedQty=9` |
| `AC-STK-07` | 提交后锁定 | 提交后再录行 → 422；单子 `Status='submitted'`、`SyncedToG1` 非空 |
| `AC-STK-08` | 空单不可提交 | 无任何行的单子提交 → 422 |
| `AC-STK-09` | 未知条码 | 录不存在条码 → 404，不产生任何行 |
| `AC-STK-10` | 删除级联 | 删除盘点单 → 头与行都被删除，无孤儿行 |
| `AC-STK-11` | 差异报告 | 详情接口返回的每行 `Variance == CountedQty − SystemQty` |
| `AC-STK-12` | 权限 | 无 `inventory.edit` 账号 → 全部 M3 接口 403/40003 |

> 若 Q13 改为"提交时统一写 g1"：`AC-STK-04` 改为"录行后 `g1.Surplus` **不变**；提交后全部行一次性生效"；`AC-STK-05` 同理。

---

## 7. 数据库连接方式

### 7.1 连接配置（对外暴露为环境变量，不得硬编码）
| 变量 | 含义 | 示例 |
|---|---|---|
| `MSSQL_SKLAD_SERVER` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` | 商品库连接 | `10.8.0.4` / `1433` / `5258` / `***` / `SKLAD` |
| `MSSQL_SALEDATA_SERVER` / `_PORT` / `_USER` / `_PASSWORD` / `_DATABASE` | 销售库连接 | 同上 / `SaleData` |
| `MSSQL_POOL_MAX` | 每个连接池最大连接数 | `10` |
| `MSSQL_REQUEST_TIMEOUT_MS` | 单次查询超时 | `30000` |
| `REPLICA_ENABLED` / `REPLICA_DB_PATH` / `REPLICA_SYNC_CRON` | 本地镜像（仅 Q12=需要时） | `1` / `./data/store_replica.db` / `*/30 * * * *` |

**多店铺实现方式**：店铺注册表存 `store.id + backend_type + conn_json（连接信息 JSON）+ is_active`，运行时按 `storeId` 从注册表取连接配置，**同一店铺的 SKLAD / SaleData 用两个独立连接池**。

### 7.2 连接池要求
| 要求 | 说明 |
|---|---|
| 池的键 | `server:port/database/user`。**同一配置复用一个池**，不要每次请求新建 |
| 健康检查 | 取出池时若 `pool.connected === false`，关闭并重建 |
| 断链自愈 | 监听 `pool.on('error')`，记录日志后**从缓存中移除该池**，下一次请求自动重连 |
| 配置变更 | 店铺连接信息更新后，必须主动关闭旧池（否则旧凭据连接泄漏） |
| 参数 | `max = MSSQL_POOL_MAX`、`min = 0`、`idleTimeoutMillis = 30000`、`connectionTimeout = 15000`、`requestTimeout = MSSQL_REQUEST_TIMEOUT_MS`；内网隧道场景 `encrypt=false, trustServerCertificate=true`（若走公网必须改为 `encrypt=true`，见 Q10） |
| 优雅退出 | 进程退出时关闭全部池 |

### 7.3 查询实现规范
1. **全部参数化**：`request.input(name, type, value)`，类型必须显式（见 §4.1 类型表）；**禁止**把用户输入拼进 SQL。
2. **动态 WHERE 只拼列名与占位符**，值一律走 `input()`。
3. **字段类型绑定表**（g1 关键项）：`Nazov nvarchar(510)`、`Barcode varchar(13)`、`Kod nvarchar(510)`、`Cena/Cena2/PovCena/PurchasePrice money`、`Surplus/Mnozstvo real`、`WarningAt smallint`、`conv2ndtobarcode/barcodeType/DPHtype/Dozen/Box int`、`Shelves/LastInstallQty float`、`Reserved/VIPnoDiscount/NotNewForCloud/IsUpdateCloud bit`、`Element nvarchar(max)`。
4. **条码一律 `TRIM()` 后比较**：库中存在带尾部空格的条码，`= @bc` 会漏命中。
5. **分页**：`ORDER BY <whitelisted col> <dir>, Barcode ASC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY`；`total` 用单独 `COUNT(*)` 查询（同 WHERE）。
6. **Top N**：`SELECT TOP (@limit)`；`limit` 在应用层先做 `[1,200]` 截断。
7. **聚合必须贴近数据源**（`SUM/GROUP BY` 在库内完成），禁止把全表拉到应用层再聚合——除了"按品类汇总"这种跨库关联场景（原因见 7.5）。
8. **批量 IN 查询**：500 个一组分批，避免参数上限与执行计划退化。

### 7.4 事务处理（原系统现状 + 目标要求）

| 场景 | 原系统做法 | 目标要求 |
|---|---|---|
| 新建商品（`INSERT g1` + 2 条价格历史） | 无事务；价格历史失败仅记日志，不影响结果 | **保持"主表优先"语义**：可以用事务包住"INSERT + 价格历史"，但**价格历史失败不得导致新建失败** |
| 行内编辑（`UPDATE g1` + 价格历史） | 无事务，同上 | 同上 |
| 批量改价 | **逐行 `UPDATE` + 逐行写历史，无事务**；中途失败会留下部分已改 | 两种可选：① 保持逐行（需在响应中返回 `affected`，并在文档写明"部分成功"语义）；② 用单事务包裹全部行（失败全回滚）。**必须二选一并写入文档**，不得含糊 |
| 盘点录行 | **跨库两写，无事务**：先写 `SaleData.StocktakeLine`，再 `UPDATE SKLAD.g1` | **不可能原子化**（跨两个库）。要求：① 顺序固定为"先 line 后 g1"或"先 g1 后 line"，并在文档写明；② 第二步失败时**必须**返回明确错误，且允许用户重扫同一条码重放（幂等 upsert）来修复；③ 日志记录中间态 |
| 盘点提交 | 单表 `UPDATE Stocktake` | 单语句，天然原子 |
| 盘点删除 | 两次 `DELETE`（行、头） | 必须用事务包裹（同一库内可原子） |
| 品类批量归类 | **单事务**批量 upsert（SQLite） | 必须单事务；任一条失败整体回滚 |

**禁止**：跨数据库的分布式事务；长事务（例如把整个盘点过程放在一个事务里）。

### 7.5 跨库/跨源数据关联的唯一例外
销售数据在 `SaleData`，商品分类在本地库（原为 SQLite）。两者**无法 JOIN**。因此：
1. 先在 `SaleData` 内按条码聚合 `(Barcode, SoldQty, Revenue)`；
2. 拉回应用层，与本地分类表做**内存关联**（按条码 Map）；
3. 关联不上的条码进 `__uncat__` 桶。
> 目标系统若把两者放在同一库，应改为**数据库内 JOIN**，并保证 §5.5 的 `AC-SAL-11` 仍然成立。

### 7.6 异常处理
| 场景 | 处理方式 | 用户可见结果 |
|---|---|---|
| 参数非法（数字/日期/超长） | 抛 `422/42201` + 具体中文消息 | toast 显示消息 |
| 资源不存在 | `404/40404` | toast |
| 条码重复 | `409/40901`（新建专用，前端就地展示） | 条码字段下方红字 |
| 无权限 / 越店铺 | `403/40003` | toast，并跳转选店 |
| 数据库不可达 | 若 Q12=需要：降级读本地镜像；写入抛 `422` 消息 `门店数据库当前离线，写入功能暂停；恢复连接后自动恢复`。<br>若 Q12=不需要：`500/50000` + 明确消息 | toast，不清空页面数据 |
| 查询超时 | 返回 `500/50000`，日志记录 SQL 摘要（不含参数明文） | toast"查询超时，请缩小时间范围" |
| 未捕获异常 | 全局错误中间件统一序列化，**不得把堆栈返回给前端** | 通用错误提示 |
| 日志 | 每个失败请求记录：路由、用户、店铺、错误码、耗时；**不得记录密码与完整 SQL 参数** | — |

**幂等性要求**：M3 录行、M2 品类写入均必须幂等（重复提交同样的数据不产生重复行/重复计数）。

---

## 8. 边界情况与校验规则总表（必须逐条实现并可测）

| 编号 | 场景 | 输入/条件 | 期望行为 |
|---|---|---|---|
| `B-01` | 条码带空格 | `" 12345 "` | 服务端 `TRIM` 后使用；查得中已存在商品 |
| `B-02` | 条码超长 | 14 位以上 | `422`，消息含"长度不能超过 13 位" |
| `B-03` | 条码为空/纯空格 | `""`、`"   "` | `422` |
| `B-04` | 条码大小写 | 含字母的条码 `ab123` vs `AB123` | 按数据库排序规则比较；**原系统未做大小写归一**，需在文档中明确 ASCII 大小写不敏感还是敏感（`【待确认-Q20】`） |
| `B-05` | 品名超长 | > 510 字符 | 截断或 `422`（必须统一，建议 `422` 并提示最大长度） |
| `B-06` | 数量小数 | `Surplus = 2.5` | 允许（`REAL`），前后端都按最多 2 位小数展示 |
| `B-07` | 数量为负 | `Surplus = -1` | 允许落库（清理历史负库存需要），状态判定为 `out`；**新建与编辑都不拦负数** |
| `B-08` | 盘点实盘数为负 | `countedQty = -1` | `422` 拒绝（与 B-07 不同，盘点必须 ≥0） |
| `B-09` | 价格精度 | `Cena = 1.239` | `MONEY` 存 4 位小数；展示 2 位；回读比较用数值而非字符串 |
| `B-10` | `Cena=0` 的销售行 | 流水 `Cena=0` | 计入销量、销售额计 0；**不做过滤**；统计页需能显示"约 X% 销量无金额"的提示 |
| `B-11` | 日期区间颠倒 | `from > to` | 返回空结果集（不报错）；文档需写明 |
| `B-12` | 日期格式非法 | `2026-13-01`、`2026/01/01` | `422`，消息"格式应为 YYYY-MM-DD" |
| `B-13` | 跨时区日界 | 门店时区 23:30 的销售 | 按**门店本地日**归属；原实现按 UTC 截断可能偏 1–2 小时 → 目标系统必须按 Q7 的时区显式换算，并在验收用例中覆盖"本地 23:59 的销售归入当天" |
| `B-14` | ISO 周跨年 | 2026-12-28 ~ 2027-01-03 | 归入同一 ISO 周（`2027-W01` 或 `2026-W53`，按 ISO 8601 计算），不得拆成两周 |
| `B-15` | 分页越界 | `page=99999` | 返回空数组 + 正确 `total`，不报错 |
| `B-16` | `pageSize` 越界 | `0` / `10000` | 分别截断到 `1` / `200`，不报错 |
| `B-17` | `limit` 越界 | `0` / `1000` | 截断到 `1` / `200`，不报错 |
| `B-18` | 排序注入 | `sortBy=Surplus;DROP TABLE g1` | 回退默认排序，`422` 或静默忽略；**绝不拼进 SQL** |
| `B-19` | SQL 注入字符串 | 搜索框输入 `' OR 1=1 --` | 作为普通字符串处理，返回 0 行 |
| `B-20` | Unicode/变音 | `Názov = "Dámske tričká"` | 正确存储与检索；关键词归类时需去变音再匹配 |
| `B-21` | 已提交盘点再录行 | `Status='submitted'` | `422` |
| `B-22` | 盘点重复扫码 | 同条码两次 | 覆盖同一行，不新增行；差异按最后一次算 |
| `B-23` | 盘点录未知条码 | 条码不在商品表 | `404`，且不产生 `StocktakeLine`，不改 `g1` |
| `B-24` | 空盘点提交 | 0 行 | `422` |
| `B-25` | 删除已提交盘点 | 允许与否未定 | 见 `【待确认-Q19】`；若允许，必须二次确认且记录操作日志 |
| `B-26` | 批量改价无任何价格 | `patch` 为空 | `422` |
| `B-27` | 批量改价无筛选 | `filter` 为空、`barcodes` 为空 | `422`，含"禁止全表改价" |
| `B-28` | 批量改价超量 | 600 个 barcodes | 拒绝或分批，行为需在文档写明（原实现截断到 500） |
| `B-29` | 价格历史写失败 | 历史表不可写 | 主流程成功，仅日志；接口仍返回成功 |
| `B-30` | 数据库断链时写入 | 连接不可达 | 明确报错，**不得静默成功**；不得让 UI 显示"已保存" |
| `B-31` | 同一请求并发两次编辑 | 两个 PATCH 同时 | 后提交者覆盖；`PriceHistory` 产生两条（`OldValue` 以各自读到值为准）——需在文档写明"无乐观锁" |
| `B-32` | 商品被 POS 删除后再编辑 | 编辑时 `404` | 提示"商品已不存在"，前端刷新列表 |
| `B-33` | 系统库存为 NULL | 历史脏数据 `Surplus IS NULL` | 视为 `0`（状态 `out`；盘点计算 `Variance = CountedQty - 0`） |
| `B-34` | 数量极值 | `Surplus = 1e12` | 不溢出；展示按千分位 |
| `B-35` | 销售区间跨年 | `from=2025-01-01, to=2026-12-31` | 正常返回，分页/聚合不因数据量大而超时（必要时限制最大跨度，并写明上限） |

---

## 9. 交付物格式与范围

### 9.1 交付物清单（缺一不可）
| # | 交付物 | 格式要求 |
|---|---|---|
| 1 | **源代码** | 按 §3.2 分层组织：路由 / 业务服务 / 数据访问；所有 SQL 集中，无字符串拼接；关键函数带注释说明对应本文规则编号（如 `// R-INV-4`） |
| 2 | **数据库迁移脚本** | 建表 + 索引 + 约束，可重复执行（`IF NOT EXISTS` 幂等）；含 `PriceHistory`、`Stocktake`、`StocktakeLine`、（可选）`categories`、`product_meta` |
| 3 | **接口文档** | 每个接口：方法、路径、鉴权、入参（类型/约束/默认值）、出参结构、错误码、示例请求/响应（至少 1 成功 + 2 失败） |
| 4 | **字段映射表** | 若目标库字段名/类型与原 `g1` 不同，必须提供 32 行完整映射（原字段 → 目标字段 → 类型 → 可写性） |
| 5 | **单元测试** | 覆盖：库存状态判定、白名单过滤、数量校验、毛利四函数、补货公式、ISO 周计算、品类关键词匹配、差异计算 |
| 6 | **集成测试** | 覆盖 §10 的端到端用例（真实数据库或容器化数据库） |
| 7 | **种子数据** | 至少 12 条商品（覆盖有货/低库存/缺货/负库存/NULL 库存/长品名/带空格条码），以及 ≥3 天的销售流水（含 `Delta>0`、`Cena=0`、被排除的 `AppName` 行） |
| 8 | **验收报告** | 逐条填写 `AC-INV-01..14`、`AC-SAL-01..14`、`AC-STK-01..12`，每项给出实测证据（截图/SQL 结果/测试输出），未通过项必须列明原因 |
| 9 | **README** | 环境变量清单、启动方式、数据库账号权限要求、时区/货币设定、已知限制 |

### 9.2 建议目录结构（可按目标栈调整，但层次不得合并）
```
src/
  modules/
    inventory/      { routes, service, repository, validators, types }
    stocktake/      { routes, service, repository, validators }
    sales/          { routes, service, repository, analytics, category-rules }
  core/
    db/             { pool, transaction, error-mapping }
    http/           { envelope, error-middleware, auth, permission }
  migrations/
  tests/            { unit, integration, fixtures }
```

### 9.3 明确的范围外（OUT OF SCOPE）
1. 进货单 Excel 上传、按条码比对、价格决策、导出 POS 货单（原系统模块三）。
2. 多店汇总视图、调货、低库存邮件通知、价格历史定时比对任务。
3. 账户/角色/权限的**管理界面**（但接口层鉴权必须实现，见 Q6）。
4. 报表 PDF 渲染、打印排版。
5. 前端视觉设计语言的重做——**移植的是行为，不是像素**；但 §4.5/§5.4/§6.5 列出的交互要素（二次确认、状态徽章带文字、空态、tab 结构）必须保留。

### 9.4 代码质量红线
- 任何形式的 SQL 字符串拼接 → **直接不通过**。
- 把 `WarningAt` 放进普通库存编辑的可写集合 → **不通过**。
- 在 M2 的读路径上写库 → **不通过**。
- 用 `SELECT *` 后在前端过滤代替数据库筛选 → **不通过**（分页会错）。
- 未实现"跨库两写"的失败可见性（静默吞掉 `g1` 写入失败）→ **不通过**。

---

## 10. 验收测试用例（可直接执行）

### 10.1 前置：种子数据（`【待确认-Q17】` 确认后使用）
```
商品（Barcode / Nazov / Surplus / WarningAt / Cena / Cena2）
1000000000001 / 甲商品 正常     / 50  / 10 / 12.30 / 8.00
1000000000002 / 乙商品 低库存   / 5   / 10 / 12.30 / 8.00
1000000000003 / 丙商品 缺货     / 0   / 0  / 3.00  / 1.00
1000000000004 / 丁商品 负库存   / -3  / 5  / 5.00  / 2.00
1000000000005 / 戊商品 无价     / 20  / 0  / 0     / 0
1000000000006 / " 1000000000006 "（带空格条码）/ 1 / 0 / 1.00 / 0
…共 12 条，含 NULL Surplus、超长品名、变音字符品名

销售流水（3 天）
D1: 条码1 Delta=-2 Cena=12.30 AppName='POS'
D1: 条码1 Delta=+5  Cena=12.30 AppName='POS'     ← 入库，不得计入销量
D2: 条码2 Delta=-10 Cena=0     AppName='POS'     ← 有量无额
D2: 条码3 Delta=-1  Cena=3.00  AppName='Tedious' ← 必须被排除
D3: 条码1 Delta=-3  Cena=12.30 AppName='POS'
```
期望结果（用于断言）：
- `/summary`：`totalQty = 2 + 10 + 3 = 15`，`totalRevenue = 24.60 + 0 + 36.90 = 61.50`
- `/top` 第一行：条码2（`SoldQty=10`），第二行：条码1（`SoldQty=5`）
- `/slow` 第一条：无销售且有库存的商品（`SoldQty=0`）
- `/restock`（`days=30`）：条码2 `DailyRate=0.333`、`DaysLeft=15.0`、`SuggestedQty=0`（若 `Surplus=5` 且已够 30 天）

### 10.2 M1 端到端用例
1. 搜索 `q=甲` → 命中 1 行；搜索 `q=1000000000006` → 命中带空格的条码行（验证 `TRIM`）。
2. `stock=low` → 仅返回乙、丁（`WarningAt>0 且 Surplus<=WarningAt`）；`stock=out` → 丙、丁；两者无交集（验证 AC-INV-03）。
3. 翻页 `pageSize=5` 遍历全部 → 条码集合与 `total` 一致且无重复（AC-INV-01）。
4. 新建条码 `1000000000001` → 409/40901，且该行 `Nazov` 未变（AC-INV-04）。
5. 新建条码 `9999999999999` 仅填品名 → 201/0，回读 32 字段默认值正确（AC-INV-05）。
6. PATCH `{ WarningAt: 99 }` → 422；`SELECT WarningAt` 未变（AC-INV-06）。
7. PATCH `{ Cena: 20 }` → 成功；`PriceHistory` 新增 1 行；再 PATCH `{ Cena: 20 }` → 不新增（AC-INV-07/08）。
8. `batch-price` 空条件 → 422；按 `supplier` 改价 → 仅该供应商行变动（AC-INV-09/10）。

### 10.3 M3 端到端用例
1. 建单（不传 name）→ 名称 `盘点-YYYY-MM-DD`。
2. 录条码1 实盘 7、警戒线 5 → 返回 `Variance=-3`；`g1` 中 `Surplus=7, WarningAt=5`（AC-STK-02/04/05）。
3. 同条码再录 9 → 行数仍为 1，`CountedQty=9`（AC-STK-06）。
4. 提交 → `Status='submitted'`、`SyncedToG1` 非空；再录行 → 422（AC-STK-07）。
5. 空单提交 → 422（AC-STK-08）；录未知条码 → 404 且无副作用（AC-STK-09）。
6. 删除 → 头行皆无（AC-STK-10）。

### 10.4 M2 端到端用例
1. `/summary` 断言 §10.1 的 `15 / 61.50`（AC-SAL-01/02/03）。
2. `/timeseries?granularity=day` 返回 3 个点；`=week` 的 `period` 符合 `YYYY-Www`；构造跨年数据验证 ISO 周（AC-SAL-04/14）。
3. `/top?limit=1000` → 最多 200 行且降序（AC-SAL-05）。
4. `/slow` 首行为零销量有库存商品（AC-SAL-06）。
5. `/restock?days=30` 断言三个派生字段与公式一致（AC-SAL-07/08）。
6. 毛利四函数单测（AC-SAL-09/10）。
7. `/by-category`：各品类 `revenueShare` 之和 = 1，`Σ revenue == /summary.totalRevenue`，`__uncat__` 在末尾（AC-SAL-11/12）。

---

## 11. 术语与字段对照表

| 术语 | 含义 |
|---|---|
| `g1` | 商品主表（SQL Server `SKLAD.dbo.g1`），32 字段 |
| `Surplus` | **可售库存**，全系统唯一库存口径 |
| `Cena` | 售价，**含 VAT 23%** |
| `Cena2` | 进货价，**不含税** |
| `WarningAt` | 低库存警戒线，**仅盘点可写** |
| `Barcode` | 唯一匹配键（T0 精确），`varchar(13)` |
| `Kod` | 货号，非唯一，二级搜索（T1） |
| `Delta` | 销售流水的库存变化量，**负值 = 卖出** |
| `SystemQty` | 盘点录行时刻的 `Surplus` 快照 |
| `Variance` | `CountedQty − SystemQty` |
| `Gap` | 低库存缺口 = `WarningAt − Surplus` |
| `DailyRate` | 日均销量 = `SoldQty / days` |
| `DaysLeft` | 可售天数 = `Surplus / DailyRate` |
| `T0 / T1` | 搜索优先级：T0=条码精确，T1=货号模糊 |
| 能力（capability） | 细粒度权限项：`inventory.view / inventory.edit / product.create / sales.view / alert.view` |

---

## 12. 给实现方的执行顺序建议

1. **先答复 §2**（Q1–Q20）。未答复前只做只读调研。
2. 搭骨架：连接池 + 错误信封 + 参数校验工具 + 权限中间件（对应 §7.1/§3.3/§7.6）。
3. M1 数据层（32 字段 + 白名单 + 参数化查询）→ M1 接口 → M1 前端 → 跑 `AC-INV-*`。
4. M3（依赖 M1 的库存读写）→ 跑 `AC-STK-*`。
5. M2（先聚合正确性，再派生指标，最后品类归类）→ 跑 `AC-SAL-*`。
6. 补 §8 边界用例（至少覆盖 `B-01/02/07/08/11/13/14/16/17/18/21/23/27/30`）。
7. 提交 §9 全部交付物 + 填完验收报告。

> **提醒**：本文所有数值、字段名、错误码、排序规则、写库时机都来自生产系统实测，属于**不可协商的等价性要求**。任何"我觉得更合理"的改动，必须先提出并获得确认，再更新本文对应条目。
