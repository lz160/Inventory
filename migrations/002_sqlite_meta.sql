-- =============================================================================
-- Migration 002: Local SQLite Metadata Schema (categories & product_meta)
-- Used for M2 Category Analytics & Auto-Categorization
-- Idempotent: Safe to re-run multiple times
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories (
  code       TEXT PRIMARY KEY,
  name_sk    TEXT NOT NULL,
  name_zh    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_meta (
  barcode    TEXT PRIMARY KEY,
  category   TEXT NULL REFERENCES categories(code),
  name_zh    TEXT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS IX_product_meta_category ON product_meta(category);
