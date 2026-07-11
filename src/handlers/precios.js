// Muestra lista de servicios y precios
const { supabase } = require('../db/client');

module.exports = async function precios({ numero, sock }) {
  const { data, error } = await supabase.from('servicios').select('*');

  if (error || !data.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios disponibles por ahora.' });
    return;
  }

  const lista = data.map(s => `• ${s.nombre}: $${s.precio} (${s.duracion_min} min)`).join('\n');
  await sock.sendMessage(numero, { text: `Nuestros servicios:\n${lista}` });
};