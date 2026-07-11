-- Tabla para persistir la sesión de Baileys (reemplaza archivos locales)
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);