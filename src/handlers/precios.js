// Muestra lista de servicios y precios
const { supabase } = require('../db/client');
const { generarRespuestaNatural } = require('../ai/gemini');

module.exports = async function precios({ numero, sock }) {
  const { data, error } = await supabase.from('servicios').select('*');

  if (error || !data.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios disponibles por ahora.' });
    return;
  }

  const respuesta = await generarRespuestaNatural({
    tipo: 'mostrar_precios',
    servicios: data.map(s => ({ nombre: s.nombre, precio: s.precio })),
  });
  await sock.sendMessage(numero, { text: respuesta });
};