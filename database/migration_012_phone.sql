-- Apply once. Preserve memberships before replacing their referenced table.
CREATE TABLE phone_memberships_copy AS SELECT * FROM account_memberships;
CREATE TABLE phone_platform_copy AS SELECT * FROM account_platform;
DROP TABLE account_memberships;
DROP TABLE account_platform;
CREATE TABLE accounts_phone_new(id TEXT PRIMARY KEY,email TEXT UNIQUE,secret TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,phone TEXT UNIQUE);
INSERT INTO accounts_phone_new(id,email,secret,session_version,created_at) SELECT id,email,secret,session_version,created_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_phone_new RENAME TO accounts;
CREATE TABLE account_memberships(account_id TEXT NOT NULL REFERENCES accounts(id),user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),PRIMARY KEY(account_id,tenant_id));
CREATE TABLE account_platform(account_id TEXT PRIMARY KEY REFERENCES accounts(id),admin_id TEXT UNIQUE NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE);
INSERT INTO account_memberships SELECT * FROM phone_memberships_copy;
INSERT INTO account_platform SELECT * FROM phone_platform_copy;
DROP TABLE phone_memberships_copy;
DROP TABLE phone_platform_copy;
