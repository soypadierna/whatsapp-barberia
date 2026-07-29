// Guarda el último contexto relevante por número en Supabase (persiste entre reinicios/redeploys),
// para que mensajes cortos como "gracias" tras completar una acción no reciban un saludo genérico
const { supabase } = require('../db/client');
const logger = require('../utils/logger');

const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

async function registrarInteraccion(numero, ultimaAccion) {
  const { error } = await supabase
    .from('historial_reciente')
    .upsert({ numero, ultima_accion: ultimaAccion, updated_at: new Date().toISOString() });

  if (error) logger.error(`Fallo guardando historial reciente para ${numero}`, error.message);
}

async function obtenerContextoReciente(numero) {
  const { data, error } = await supabase
    .from('historial_reciente')
    .select('ultima_accion, updated_at')
    .eq('numero', numero)
    .maybeSingle();

  if (error) {
    logger.error(`Fallo leyendo historial reciente para ${numero}`, error.message);
    return null;
  }

  if (!data) return null;

  const transcurrido = Date.now() - new Date(data.updated_at).getTime();
  if (transcurrido > TRES_HORAS_MS) {
    // Expiró: limpia la fila para no acumular basura, y trata como conversación nueva
    await supabase.from('historial_reciente').delete().eq('numero', numero);
    return null;
  }

  return data.ultima_accion;
}

module.exports = { registrarInteraccion, obtenerContextoReciente };