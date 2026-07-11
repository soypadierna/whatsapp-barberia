-- Tabla para guardar tokens OAuth de Google Calendar por barbero
CREATE TABLE calendar_tokens (
  id SERIAL PRIMARY KEY,
  barbero_id INTEGER REFERENCES barberos(id) UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date BIGINT,
  calendar_id TEXT DEFAULT 'primary'
);