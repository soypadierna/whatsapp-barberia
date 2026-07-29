-- Agrega columna para evitar enviar el mismo recordatorio más de una vez (Fase 37)
ALTER TABLE citas ADD COLUMN recordatorio_enviado BOOLEAN DEFAULT false;