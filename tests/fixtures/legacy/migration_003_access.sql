-- Aplicar después de schema.sql y migration_002_platform.sql, con el servicio detenido.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE platform_admins ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gates ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE codes ADD COLUMN owner_id TEXT;
ALTER TABLE codes ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE codes ADD COLUMN claim_token TEXT;
ALTER TABLE codes ADD COLUMN claimed_at INTEGER;
ALTER TABLE logs ADD COLUMN outcome TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE logs ADD COLUMN gate_name TEXT;
ALTER TABLE logs ADD COLUMN owner_id TEXT;
UPDATE logs SET owner_id=(SELECT id FROM users WHERE users.tenant_id=logs.tenant_id AND users.username=logs.owner);
UPDATE logs SET gate_name = (SELECT name FROM gates WHERE gates.id=logs.gate_id AND gates.tenant_id=logs.tenant_id);
UPDATE codes SET owner_id = (SELECT id FROM users WHERE users.tenant_id=codes.tenant_id AND users.username=codes.owner);
UPDATE codes SET status='revoked' WHERE owner_id IS NULL;
CREATE TABLE user_gates (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gate_id TEXT NOT NULL REFERENCES gates(id),
  PRIMARY KEY (user_id, gate_id)
);
INSERT INTO user_gates (tenant_id,user_id,gate_id)
 SELECT u.tenant_id,u.id,g.id FROM users u JOIN gates g ON g.tenant_id=u.tenant_id WHERE u.role!='master';
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX idx_codes_owner_id ON codes(tenant_id,owner_id);
CREATE INDEX idx_codes_status ON codes(status,claimed_at);
