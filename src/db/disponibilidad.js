// Valida disponibilidad de un barbero en fecha/hora específica
const { supabase } = require('../db/client');

async function estaDisponible(barberoId, fecha, hora) {
  const { data: barbero } = await supabase
    .from('barberos').select('horario_inicio, horario_fin').eq('id', barberoId).single();

  if (!barbero) return { disponible: false, motivo: 'Barbero no existe' };

  if (hora < barbero.horario_inicio || hora >= barbero.horario_fin) {
    return { disponible: false, motivo: 'Fuera de horario de atención' };
  }

  const { data: ocupado } = await supabase
    .from('citas')
    .select('id')
    .eq('barbero_id', barberoId)
    .eq('fecha', fecha)
    .eq('hora', hora)
    .eq('estado', 'pendiente')
    .maybeSingle();

  if (ocupado) return { disponible: false, motivo: 'Horario ya ocupado' };

  return { disponible: true };
}

module.exports = { estaDisponible };