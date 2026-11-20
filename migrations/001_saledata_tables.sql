-- =============================================================================
-- Migration 001: SQL Server SaleData Schema (PriceHistory, Stocktake, StocktakeLine)
-- Target Database: SaleData (SQL Server)
-- Idempotent: Safe to re-run multiple times
-- =============================================================================

-- 1. PriceHistory (Tracks Cena and Cena2 changes on SKLAD.dbo.g1)
IF OBJECT_ID(N'dbo.PriceHistory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PriceHistory (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    Barcode   VARCHAR(13) NOT NULL,
    Nazov     NVARCHAR(510) NULL,
    Field     NVARCHAR(10) NOT NULL,     -- 'Cena' | 'Cena2'
    OldValue  MONEY NULL,                -- NULL for initial creation baseline
    NewValue  MONEY NULL,
    ChangedBy NVARCHAR(100) NOT NULL,
    ChangedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Source    NVARCHAR(10) NOT NULL      -- 'ims' | 'scheduled'
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_PriceHistory_BarcodeField' AND object_id = OBJECT_ID(N'dbo.PriceHistory')
)
BEGIN
  CREATE INDEX IX_PriceHistory_BarcodeField ON dbo.PriceHistory(Barcode, Field, Id DESC);
END;
GO

-- 2. Stocktake (Physical inventory count session header)
IF OBJECT_ID(N'dbo.Stocktake', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Stocktake (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Name        NVARCHAR(200) NOT NULL,
    CountDate   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy   NVARCHAR(100) NOT NULL,
    Status      NVARCHAR(20) NOT NULL DEFAULT N'open', -- 'open' | 'submitted'
    SyncedToG1  DATETIME2 NULL
  );
END;
GO

-- 3. StocktakeLine (Individual counted barcode rows; no UNIQUE constraint on Barcode per spec §6.1, upserted by (StocktakeId, Barcode))
IF OBJECT_ID(N'dbo.StocktakeLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.StocktakeLine (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    StocktakeId INT NOT NULL REFERENCES dbo.Stocktake(Id),
    Barcode     VARCHAR(13) NOT NULL,
    Nazov       NVARCHAR(510) NULL,
    SystemQty   REAL NULL,      -- Snapshot of g1.Surplus at line-entry time
    CountedQty  REAL NULL,      -- Physical count (>= 0)
    Variance    REAL NULL,      -- CountedQty - SystemQty
    WarningAt   REAL NULL,      -- Optional low-stock threshold updated on g1
    Notes       NVARCHAR(1000) NULL
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_StocktakeLine_Stocktake' AND object_id = OBJECT_ID(N'dbo.StocktakeLine')
)
BEGIN
  CREATE INDEX IX_StocktakeLine_Stocktake ON dbo.StocktakeLine(StocktakeId);
END;
GO
