-- Falla si hay duplicados: resolverlos explícitamente antes de migrar.
CREATE UNIQUE INDEX IF NOT EXISTS codes_global_unique ON codes(code);
