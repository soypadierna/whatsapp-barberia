// Router de intents usando Gemini
const handlers = {
  agendar: require('../handlers/agendar'),
  cancelar: require('../handlers/cancelar'),
  horarios: require('../handlers/horarios'),
  precios: require('../handlers/precios'),
};

const { detectarIntent } = require('../ai/gemini');

async function enrutarMensaje({ texto, numero, sock }) {
  const intent = await detectarIntent(texto);

  if (!intent || !handlers[intent]) {
    await sock.sendMessage(numero, {
      text: 'No entendí tu mensaje. Puedes preguntarme por: agendar, cancelar, horarios o precios.',
    });
    return;
  }

  await handlers[intent]({ texto, numero, sock });
}

module.exports = { enrutarMensaje };