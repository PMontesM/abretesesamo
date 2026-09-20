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
