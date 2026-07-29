// Router de intents usando Gemini
const handlers = {
  agendar: require('../handlers/agendar'),
  cancelar: require('../handlers/cancelar'),
  horarios: require('../handlers/horarios'),
  precios: require('../handlers/precios'),
  admin: require('../handlers/admin'),
};

const { procesarMensajeInicial } = require('../ai/provider');
const { obtenerEstado } = require('./estadoConversacion');
const { estaPausado } = require('../db/estadoBot');
const { obtenerContextoReciente, registrarInteraccion } = require('../core/historialReciente');

const logger = require('../utils/logger');

async function enrutarMensaje({ texto, numero, sock }) {
  if (texto.toLowerCase().startsWith('admin')) {
    return handlers.admin({ texto, numero, sock });
  }

  if (estaPausado()) {
    logger.mensaje(`Bot pausado, mensaje de ${logger.enmascararNumero(numero)} ignorado`);
    return;
  }

  if (obtenerEstado(numero)) {
    return handlers.agendar({ texto, numero, sock });
  }

  try {
    const contextoReciente = obtenerContextoReciente(numero);
    const { intent, respuesta } = await procesarMensajeInicial(texto, contextoReciente);
    logger.mensaje(`Intent detectado para ${logger.enmascararNumero(numero)}: ${intent || 'ninguno'}`);

    if (!intent || !handlers[intent]) {
      await sock.sendMessage(numero, { text: respuesta || '¡Hola! ¿En qué te puedo ayudar? Puedo agendar tu cita, darte precios u horarios.' });
      registrarInteraccion(numero, 'mensaje_general');
      return;
    }

    await handlers[intent]({ texto, numero, sock });
  } catch (err) {
    logger.error('Error no capturado en router', err.stack);
    await sock.sendMessage(numero, { text: 'Dame un segundo y vuelvo a intentar 🙏' });
  }
}

module.exports = { enrutarMensaje };