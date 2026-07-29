CREATE TABLE historial_reciente (
  numero TEXT PRIMARY KEY,
  ultima_accion TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT now()
);

ALTER TABLE historial_reciente DISABLE ROW LEVEL SECURITY;