// Router simple de intents por palabras clave
const handlers = {
  agendar: require('../handlers/agendar'),
  cancelar: require('../handlers/cancelar'),
  horarios: require('../handlers/horarios'),
  precios: require('../handlers/precios'),
};

// Diccionario de palabras clave por intent
const intents = {
  agendar: ['agendar', 'reservar', 'cita', 'turno'],
  cancelar: ['cancelar', 'anular'],
  horarios: ['horario', 'horarios', 'disponibilidad'],
  precios: ['precio', 'precios', 'costo', 'cuanto cuesta'],
};

function detectarIntent(texto) {
  const t = texto.toLowerCase();
  for (const [intent, palabras] of Object.entries(intents)) {
    if (palabras.some(p => t.includes(p))) return intent;
  }
  return null;
}

async function enrutarMensaje({ texto, numero, sock }) {
  const intent = detectarIntent(texto);

  if (!intent) {
    await sock.sendMessage(numero, {
      text: 'No entendí tu mensaje. Puedes escribir: agendar, cancelar, horarios o precios.',
    });
    return;
  }

  await handlers[intent]({ texto, numero, sock });
}

module.exports = { enrutarMensaje };