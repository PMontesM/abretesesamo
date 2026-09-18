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
