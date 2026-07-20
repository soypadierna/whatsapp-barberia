// Router de intents usando Gemini
const handlers = {
  agendar: require('../handlers/agendar'),
  cancelar: require('../handlers/cancelar'),
  horarios: require('../handlers/horarios'),
  precios: require('../handlers/precios'),
  admin: require('../handlers/admin'),
};

const { detectarIntent } = require('../ai/gemini');
const { obtenerEstado } = require('./estadoConversacion');
const logger = require('../utils/logger');

async function enrutarMensaje({ texto, numero, sock }) {
  if (texto.toLowerCase().startsWith('admin')) {
    return handlers.admin({ texto, numero, sock });
  }

  if (obtenerEstado(numero)) {
    return handlers.agendar({ texto, numero, sock });
  }

  try {
    const { intent, respuesta } = await procesarMensajeInicial(texto);
    logger.mensaje(`Intent detectado para ${logger.enmascararNumero(numero)}: ${intent || 'ninguno'}`);

    if (!intent || !handlers[intent]) {
      await sock.sendMessage(numero, { text: respuesta || '¡Hola! ¿En qué te puedo ayudar? Puedo agendar tu cita, darte precios u horarios.' });
      return;
    }

    await handlers[intent]({ texto, numero, sock });
  } catch (err) {
    logger.error('Error no capturado en router', err.stack);
    await sock.sendMessage(numero, { text: 'Dame un segundo y vuelvo a intentar 🙏' });
  }
}

module.exports = { enrutarMensaje };