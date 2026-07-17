// Router de intents usando Gemini
const handlers = {
  agendar: require('../handlers/agendar'),
  cancelar: require('../handlers/cancelar'),
  horarios: require('../handlers/horarios'),
  precios: require('../handlers/precios'),
  admin: require('../handlers/admin'),
};

const { detectarIntent, generarRespuestaNatural } = require('../ai/gemini');
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
    const intent = await detectarIntent(texto);
    logger.mensaje(`Intent detectado para ${logger.enmascararNumero(numero)}: ${intent || 'ninguno'}`);

    if (!intent || !handlers[intent]) {
      const respuesta = await generarRespuestaNatural({
        tipo: 'saludo_o_no_claro',
        mensajeUsuario: texto,
      });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    await handlers[intent]({ texto, numero, sock });
  } catch (err) {
    logger.error('Error no capturado en router', err.stack);
    await sock.sendMessage(numero, { text: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  }
}

module.exports = { enrutarMensaje };