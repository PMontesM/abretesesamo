-- Tenants (cada edificio/cliente)
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Gates: el portón/dispositivo de cada tenant. Normalmente uno, pero permite varios.
-- trigger_type: 'webhook' (Alexa/IFTTT/Home Assistant), 'esp32', etc.
-- trigger_config: JSON con la configuración específica de ese tipo (url, método, headers...)
CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Usuarios que pueden entrar al panel admin (uno "master" + N "user" por tenant)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  username TEXT NOT NULL,
  secret TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'master' | 'user'
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_id, username)
);

-- Códigos de acceso al portón
CREATE TABLE IF NOT EXISTS codes (
  code TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  gate_id TEXT NOT NULL REFERENCES gates(id),
  label TEXT,
  owner TEXT,
  single_use INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_codes_tenant ON codes(tenant_id);

-- Historial de aperturas
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  gate_id TEXT,
  code TEXT,
  label TEXT,
  owner TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_tenant_at ON logs(tenant_id, at DESC);
