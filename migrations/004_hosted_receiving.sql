IF OBJECT_ID(N'dbo.ReceivingOrder', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceivingOrder (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    OrderNumber bigint IDENTITY NOT NULL UNIQUE,
    Title nvarchar(255) NOT NULL,
    CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CompletedAt datetime2(3) NULL,
    Version int NOT NULL DEFAULT 1
  );
END;

IF OBJECT_ID(N'dbo.ReceivingLine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceivingLine (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    OrderId uniqueidentifier NOT NULL REFERENCES dbo.ReceivingOrder(Id) ON DELETE CASCADE,
    LineNumber bigint IDENTITY NOT NULL,
    Sequence int NOT NULL,
    Name nvarchar(500) NOT NULL,
    ChineseName nvarchar(500) NOT NULL,
    UnitPrice decimal(18,6) NOT NULL,
    DiscountPrice decimal(18,6) NOT NULL,
    Barcode nvarchar(100) NOT NULL,
    ExpectedQty decimal(18,6) NOT NULL CHECK (ExpectedQty >= 0),
    ItemNo nvarchar(200) NOT NULL,
    UnitPrice2 decimal(18,6) NOT NULL,
    Supplier nvarchar(255) NOT NULL,
    ReceivedQty decimal(18,6) NOT NULL CHECK (ReceivedQty >= 0),
    DamagedQty decimal(18,6) NOT NULL CHECK (DamagedQty >= 0),
    ActualBilledPrice decimal(18,6) NOT NULL,
    Notes nvarchar(2000) NOT NULL,
    LastScannedAt datetime2(3) NULL,
    Version int NOT NULL DEFAULT 1
  );
  CREATE INDEX IX_ReceivingLine_Order ON dbo.ReceivingLine (OrderId, LineNumber);
END;

IF OBJECT_ID(N'dbo.ReceivingOperation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReceivingOperation (
    Id uniqueidentifier NOT NULL PRIMARY KEY,
    OperationType varchar(12) NOT NULL,
    TargetId uniqueidentifier NOT NULL,
    RecordedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
