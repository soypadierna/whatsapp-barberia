// Guarda el último contexto relevante por número (independiente del flujo de agendamiento),
// para que mensajes cortos como "gracias" tras completar una acción no reciban un saludo genérico
const historial = new Map();
const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

function registrarInteraccion(numero, ultimaAccion) {
  historial.set(numero, { ultimaAccion, timestamp: Date.now() });
}

function obtenerContextoReciente(numero) {
  const entrada = historial.get(numero);
  if (!entrada) return null;

  const transcurrido = Date.now() - entrada.timestamp;
  if (transcurrido > TRES_HORAS_MS) {
    historial.delete(numero);
    return null;
  }

  return entrada.ultimaAccion;
}

module.exports = { registrarInteraccion, obtenerContextoReciente };