// Muestra horarios de barberos activos
const { supabase } = require('../db/client');

module.exports = async function horarios({ numero, sock }) {
  const { data, error } = await supabase.from('barberos').select('*').eq('activo', true);

  if (error || !data.length) {
    await sock.sendMessage(numero, { text: 'No hay barberos disponibles por ahora.' });
    return;
  }

  const lista = data.map(b => `• ${b.nombre}: ${b.horario_inicio} - ${b.horario_fin}`).join('\n');
  await sock.sendMessage(numero, { text: `Horarios de atención:\n${lista}` });
};