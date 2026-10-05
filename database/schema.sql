-- INSTALACIÓN NUEVA. Un único esquema; no aplicar migraciones antiguas después.
-- Utilizar exclusivamente en una base nueva y vacía.
-- No contiene usuarios, contraseñas ni datos reales.
CREATE TABLE tenants (
 id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE gates (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL,
 created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE users (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 username TEXT NOT NULL, secret TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
 created_at INTEGER NOT NULL, session_version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,username)
);
CREATE TABLE codes (
 code TEXT NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 gate_id TEXT NOT NULL REFERENCES gates(id), label TEXT, owner TEXT,
 single_use INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL,
 owner_id TEXT, status TEXT NOT NULL DEFAULT 'active', claim_token TEXT, claimed_at INTEGER,
 PRIMARY KEY(tenant_id,code)
);
CREATE TABLE logs (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 gate_id TEXT, code TEXT, label TEXT, owner TEXT, at INTEGER NOT NULL,
 outcome TEXT NOT NULL DEFAULT 'sent', gate_name TEXT, owner_id TEXT
);
CREATE TABLE platform_admins (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, secret TEXT NOT NULL,
 created_at INTEGER NOT NULL, session_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE platform_audit_log (
 id TEXT PRIMARY KEY, admin_username TEXT NOT NULL, action TEXT NOT NULL,
 details TEXT, at INTEGER NOT NULL
);
CREATE TABLE user_gates (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 gate_id TEXT NOT NULL REFERENCES gates(id), PRIMARY KEY(user_id,gate_id)
);
CREATE TABLE login_attempts (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX idx_codes_tenant ON codes(tenant_id);
CREATE INDEX idx_logs_tenant_at ON logs(tenant_id,at DESC);
CREATE INDEX idx_audit_at ON platform_audit_log(at DESC);
CREATE INDEX idx_codes_owner_id ON codes(tenant_id,owner_id);
CREATE INDEX idx_codes_status ON codes(status,claimed_at);

-- Actualización aditiva, compatible con la instalación anterior. Puede repetirse.
CREATE TABLE IF NOT EXISTS direct_operations (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 gate_id TEXT NOT NULL REFERENCES gates(id), owner_id TEXT NOT NULL,
 gate_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_gate_busy ON direct_operations(tenant_id,gate_id) WHERE status IN ('pending','uncertain');
CREATE INDEX IF NOT EXISTS idx_direct_tenant_time ON direct_operations(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_gates_tenant ON gates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

ALTER TABLE codes ADD COLUMN visit_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codes ADD COLUMN visit_started_at INTEGER;

ALTER TABLE tenants ADD COLUMN support_phone TEXT NOT NULL DEFAULT '';

-- Aditiva e idempotente. No modifica la integración de portones existentes.
CREATE TABLE IF NOT EXISTS relay_commands (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL REFERENCES tenants(id), gate_id TEXT NOT NULL REFERENCES gates(id),
 source_id TEXT NOT NULL, boot_id TEXT, expires_at INTEGER,
 status TEXT NOT NULL, created_at INTEGER NOT NULL, release_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_device_busy ON relay_commands(device_id) WHERE status IN ('pending','uncertain','cooldown');
CREATE INDEX IF NOT EXISTS idx_relay_tenant ON relay_commands(tenant_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_mqtt_device ON gates(json_extract(trigger_config,'$.deviceId')) WHERE trigger_type='mqtt';
CREATE TABLE IF NOT EXISTS relay_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Enforce assignment safety inside the same database transaction as gate edits.
CREATE TRIGGER IF NOT EXISTS mqtt_gate_assignment_busy
BEFORE UPDATE OF trigger_type,trigger_config ON gates
WHEN (NEW.trigger_type!=OLD.trigger_type OR NEW.trigger_config!=OLD.trigger_config)
 AND EXISTS(SELECT 1 FROM relay_commands WHERE gate_id=OLD.id AND
 (status IN ('pending','uncertain') OR (status='cooldown' AND release_at>CAST(strftime('%s','now') AS INTEGER)*1000)))
BEGIN SELECT RAISE(ABORT,'Relay command needs review before reassignment'); END;

-- Additive, idempotent inventory. Existing gate assignments are preserved.
CREATE TABLE IF NOT EXISTS relay_devices (
 device_id TEXT PRIMARY KEY, name TEXT NOT NULL,
 connection_state TEXT NOT NULL DEFAULT 'unknown', checked_at INTEGER,
 sampled_at INTEGER, rssi INTEGER, pulse_ms INTEGER, created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO relay_devices(device_id,name,created_at)
 SELECT json_extract(trigger_config,'$.deviceId'),name,created_at
 FROM gates WHERE trigger_type='mqtt' AND json_extract(trigger_config,'$.deviceId') IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS mqtt_gate_inventory_insert
BEFORE INSERT ON gates WHEN NEW.trigger_type='mqtt'
 AND NOT EXISTS(SELECT 1 FROM relay_devices WHERE device_id=json_extract(NEW.trigger_config,'$.deviceId'))
BEGIN SELECT RAISE(ABORT,'Register relay in inventory before assignment'); END;
CREATE TRIGGER IF NOT EXISTS mqtt_gate_inventory_update
BEFORE UPDATE OF trigger_type,trigger_config ON gates WHEN NEW.trigger_type='mqtt'
 AND NOT EXISTS(SELECT 1 FROM relay_devices WHERE device_id=json_extract(NEW.trigger_config,'$.deviceId'))
BEGIN SELECT RAISE(ABORT,'Register relay in inventory before assignment'); END;

-- Additive migration; apply once to existing installations before deploying.
ALTER TABLE codes ADD COLUMN category TEXT NOT NULL DEFAULT 'Visita';
ALTER TABLE codes ADD COLUMN creation_token TEXT;
CREATE TABLE code_gates (
 tenant_id TEXT NOT NULL, code TEXT NOT NULL, gate_id TEXT NOT NULL REFERENCES gates(id),
 authorized_config TEXT NOT NULL,
 PRIMARY KEY(tenant_id,code,gate_id),
 FOREIGN KEY(tenant_id,code) REFERENCES codes(tenant_id,code) ON DELETE CASCADE
);
CREATE INDEX code_gates_gate ON code_gates(tenant_id,gate_id,code);
CREATE TABLE relay_observations (
 device_id TEXT NOT NULL REFERENCES relay_devices(device_id), hour INTEGER NOT NULL,
 checked_at INTEGER NOT NULL, state TEXT NOT NULL, rssi INTEGER, uptime_s INTEGER,
 PRIMARY KEY(device_id,hour)
);
CREATE INDEX logs_tenant_outcome_at ON logs(tenant_id,outcome,at);

-- Login único: no une cuentas existentes por nombre o correo.
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE,secret TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,phone TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS account_memberships(account_id TEXT NOT NULL REFERENCES accounts(id),user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,tenant_id TEXT NOT NULL REFERENCES tenants(id),PRIMARY KEY(account_id,tenant_id));
CREATE TABLE IF NOT EXISTS account_platform(account_id TEXT PRIMARY KEY REFERENCES accounts(id),admin_id TEXT UNIQUE NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE);

CREATE UNIQUE INDEX IF NOT EXISTS codes_global_unique ON codes(code);
