// Placeholder para futura implementación de Groq como proveedor de IA
// Debe implementar el mismo contrato: procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita

async function procesarMensajeInicial(texto) {
  throw new Error('Proveedor Groq aún no implementado');
}

async function generarRespuestaNatural(contexto) {
  throw new Error('Proveedor Groq aún no implementado');
}

async function extraerDatosCita(texto, contextoActual, catalogos) {
  throw new Error('Proveedor Groq aún no implementado');
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita };