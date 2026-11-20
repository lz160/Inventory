-- =============================================================================
-- Seed Test Data (Section 10.1 Acceptance Verification Fixtures)
-- Intended for staging / test SQL Server databases ONLY (never run on production)
-- =============================================================================

-- 12 representative products covering: normal, low stock, out of stock, negative stock,
-- zero price, trailing-space barcode, NULL surplus, long name, and Slovak diacritics.
INSERT INTO SKLAD.dbo.g1 (
  Nazov, Cena, PovCena, Barcode, Mnozstvo, Kod, Element, Class, Reserved, Surplus,
  VIPnoDiscount, barcode2nd, conv2ndtobarcode, barcodeType, DPHtype, PurchasePrice,
  Dozen, Box, menupackage, Picture, Cena2, WarningAt, MoreSurplus, ExpiryDate,
  PurchaseCountry, Supplier, Companions, NotNewForCloud, IsUpdateCloud, InstallDate,
  Shelves, LastInstallQty
)
VALUES
  (N'甲商品 正常', 12.30, 0, '1000000000001', 0, N'K-001', N'', N'', 0, 50, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 8.00, 10, N'', NULL, N'', N'SupplierA', N'', 1, 0, GETDATE(), NULL, 0),
  (N'乙商品 低库存', 12.30, 0, '1000000000002', 0, N'K-002', N'', N'', 0, 5, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 8.00, 10, N'', NULL, N'', N'SupplierA', N'', 1, 0, GETDATE(), NULL, 0),
  (N'丙商品 缺货', 3.00, 0, '1000000000003', 0, N'K-003', N'', N'', 0, 0, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 1.00, 0, N'', NULL, N'', N'SupplierB', N'', 1, 0, GETDATE(), NULL, 0),
  (N'丁商品 负库存', 5.00, 0, '1000000000004', 0, N'K-004', N'', N'', 0, -3, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 2.00, 5, N'', NULL, N'', N'SupplierB', N'', 1, 0, GETDATE(), NULL, 0),
  (N'戊商品 无价', 0, 0, '1000000000005', 0, N'K-005', N'', N'', 0, 20, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 0, 0, N'', NULL, N'', N'SupplierA', N'', 1, 0, GETDATE(), NULL, 0),
  (N'己商品 带空格条码', 1.00, 0, ' 1000000000006', 0, N'K-006', N'', N'', 0, 1, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 0, 0, N'', NULL, N'', N'SupplierC', N'', 1, 0, GETDATE(), NULL, 0),
  (N'Dámske tričko bavlna', 19.90, 0, '1000000000007', 0, N'K-007', N'', N'', 0, 15, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 8.50, 3, N'', NULL, N'', N'FashionSK', N'', 1, 0, GETDATE(), NULL, 0),
  (N'Pánske nohavice slim', 29.90, 0, '1000000000008', 0, N'K-008', N'', N'', 0, 8, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 12.00, 4, N'', NULL, N'', N'FashionSK', N'', 1, 0, GETDATE(), NULL, 0),
  (N'Detská bunda zimná', 39.90, 0, '1000000000009', 0, N'K-009', N'', N'', 0, 12, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 18.00, 2, N'', NULL, N'', N'KidsWear', N'', 1, 0, GETDATE(), NULL, 0),
  (N'NULL库存历史商品', 4.50, 0, '1000000000010', 0, N'K-010', N'', N'', 0, NULL, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 2.00, 0, N'', NULL, N'', N'SupplierC', N'', 1, 0, GETDATE(), NULL, 0),
  (N'Kuchynský nôž nerezový extra dlhý názov produktu pre testovanie zobrazenia v tabuľke skladu', 14.90, 0, '1000000000011', 0, N'K-011', N'', N'', 0, 25, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 6.00, 5, N'', NULL, N'', N'HomeGoods', N'', 1, 0, GETDATE(), NULL, 0),
  (N'Slow Moving Ceramic Mug', 6.50, 0, '1000000000012', 0, N'K-012', N'', N'', 0, 40, 0, '', 0, 0, 1, 0, 0, 0, N'', N'', 2.50, 5, N'', NULL, N'', N'HomeGoods', N'', 1, 0, GETDATE(), NULL, 0);
GO
