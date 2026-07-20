// Muestra horarios de barberos activos
const { supabase } = require('../db/client');
const { generarRespuestaNatural } = require('../ai/providers/provider');

module.exports = async function horarios({ numero, sock }) {
  const { data, error } = await supabase.from('barberos').select('*').eq('activo', true);

  if (error || !data.length) {
    await sock.sendMessage(numero, { text: 'No hay barberos disponibles por ahora.' });
    return;
  }

  const respuesta = await generarRespuestaNatural({
    tipo: 'mostrar_horarios',
    barberos: data.map(b => ({ nombre: b.nombre, inicio: b.horario_inicio, fin: b.horario_fin })),
  });
  await sock.sendMessage(numero, { text: respuesta });
};