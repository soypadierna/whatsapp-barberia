-- Tabla de barberos
CREATE TABLE barberos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  horario_inicio TIME NOT NULL,
  horario_fin TIME NOT NULL,
  activo BOOLEAN DEFAULT true
);

-- Tabla de servicios
CREATE TABLE servicios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  precio NUMERIC NOT NULL,
  duracion_min INTEGER NOT NULL
);

-- Tabla de citas
CREATE TABLE citas (
  id SERIAL PRIMARY KEY,
  barbero_id INTEGER REFERENCES barberos(id),
  cliente_telefono TEXT NOT NULL,
  servicio_id INTEGER REFERENCES servicios(id),
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  estado TEXT DEFAULT 'pendiente'
);