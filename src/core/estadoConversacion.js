// Guarda en memoria el estado de conversación por número, con expiración por inactividad (3 horas)
const estados = new Map();
const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

function obtenerEstado(numero) {
  const entrada = estados.get(numero);
  if (!entrada) return null;

  const transcurrido = Date.now() - entrada.ultimaActividad;
  if (transcurrido > TRES_HORAS_MS) {
    estados.delete(numero); // expiró: se trata como conversación nueva
    return null;
  }

  return entrada.datos;
}

function setEstado(numero, datos) {
  estados.set(numero, { datos, ultimaActividad: Date.now() });
}

function limpiarEstado(numero) {
  estados.delete(numero);
}

module.exports = { obtenerEstado, setEstado, limpiarEstado };