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
