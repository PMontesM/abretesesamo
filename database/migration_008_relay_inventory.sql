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
