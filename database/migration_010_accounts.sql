-- Login único: no une cuentas existentes por nombre o correo.
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,secret TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS account_memberships(account_id TEXT NOT NULL REFERENCES accounts(id),user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),PRIMARY KEY(account_id,tenant_id));
CREATE TABLE IF NOT EXISTS account_platform(account_id TEXT PRIMARY KEY REFERENCES accounts(id),admin_id TEXT UNIQUE NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE);
