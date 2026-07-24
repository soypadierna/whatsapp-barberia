CREATE TABLE estado_bot (
  id TEXT PRIMARY KEY,
  pausado BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP DEFAULT now()
);

INSERT INTO estado_bot (id, pausado) VALUES ('global', false);
ALTER TABLE estado_bot DISABLE ROW LEVEL SECURITY;