-- Migración 002: soporte de superadmin (panel de plataforma)
-- Ejecutar con:
--   wrangler d1 execute porton-saas-db --remote --file=./migration_002_platform.sql

ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Cuentas del panel de plataforma (separadas de los usuarios por-tenant).
-- No hay alta desde la UI a propósito: se crean solo por SQL, para que
-- el acceso de más alto privilegio del sistema nunca dependa de un formulario web.
CREATE TABLE IF NOT EXISTS platform_admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id TEXT PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON platform_audit_log(at DESC);
