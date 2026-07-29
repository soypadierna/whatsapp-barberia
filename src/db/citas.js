// Consultas de citas existentes de un cliente
const { supabase } = require('./client');

async function buscarCitasFuturas(numero) {
  const hoy = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('citas')
    .select('id, fecha, hora, estado, barbero_id, servicio_id, barberos(nombre), servicios(nombre, duracion_min)')
    .eq('cliente_telefono', numero)
    .eq('estado', 'pendiente')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (error) return [];
  return data;
}

module.exports = { buscarCitasFuturas };