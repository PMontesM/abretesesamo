CREATE TABLE IF NOT EXISTS account_recovery(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS account_recovery_expiry ON account_recovery(expires_at);
