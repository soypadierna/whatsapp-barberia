// Guarda en memoria el estado de la conversación de agendamiento por número
const estados = new Map();

function obtenerEstado(numero) {
  return estados.get(numero) || null;
}

function setEstado(numero, estado) {
  estados.set(numero, estado);
}

function limpiarEstado(numero) {
  estados.delete(numero);
}

module.exports = { obtenerEstado, setEstado, limpiarEstado };