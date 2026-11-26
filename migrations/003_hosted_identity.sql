IF OBJECT_ID(N'dbo.stores', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.stores (
    id int IDENTITY PRIMARY KEY,
    store_code varchar(32) NOT NULL UNIQUE,
    store_name nvarchar(100) NOT NULL,
    created_at varchar(24) NOT NULL,
    updated_at varchar(24) NOT NULL
  );

  CREATE TABLE dbo.users (
    id int IDENTITY PRIMARY KEY,
    username varchar(64) NOT NULL UNIQUE,
    display_name nvarchar(100) NOT NULL,
    password_hash varchar(200) NOT NULL,
    role varchar(12) NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
    permissions_json nvarchar(500) NOT NULL CHECK (ISJSON(permissions_json) = 1),
    all_stores bit NOT NULL,
    is_active bit NOT NULL,
    created_at varchar(24) NOT NULL,
    updated_at varchar(24) NOT NULL
  );

  CREATE TABLE dbo.user_stores (
    user_id int NOT NULL REFERENCES dbo.users(id) ON DELETE CASCADE,
    store_id int NOT NULL REFERENCES dbo.stores(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, store_id)
  );

  CREATE TABLE dbo.user_sessions (
    token_hash char(64) PRIMARY KEY,
    user_id int NOT NULL REFERENCES dbo.users(id) ON DELETE CASCADE,
    active_store_id int NULL REFERENCES dbo.stores(id) ON DELETE SET NULL,
    expires_at varchar(24) NOT NULL
  );
  CREATE INDEX IX_op_sessions_user ON dbo.user_sessions(user_id);
  CREATE INDEX IX_op_sessions_expiry ON dbo.user_sessions(expires_at);

  CREATE TABLE dbo.store_db_configs (
    store_id int NOT NULL REFERENCES dbo.stores(id) ON DELETE CASCADE,
    target varchar(8) NOT NULL CHECK (target IN ('sklad', 'saledata')),
    config_ciphertext nvarchar(max) NOT NULL,
    updated_at varchar(24) NOT NULL,
    PRIMARY KEY (store_id, target)
  );
END;

IF OBJECT_ID(N'dbo.hosted_store_ready', N'U') IS NULL
  CREATE TABLE dbo.hosted_store_ready (
    store_id int PRIMARY KEY REFERENCES dbo.stores(id) ON DELETE CASCADE
  );
