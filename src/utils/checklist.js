// Construye el mini-checklist visual de campos confirmados/pendientes durante el agendamiento
function construirChecklist({ servicio, barbero, fecha, hora, mostrarBarbero }) {
  const lineas = [];
  lineas.push(`${servicio ? '✅' : '⬜'} Servicio${servicio ? `: ${servicio}` : ''}`);
  if (mostrarBarbero) {
    lineas.push(`${barbero ? '✅' : '⬜'} Barbero${barbero ? `: ${barbero}` : ''}`);
  }
  lineas.push(`${fecha ? '✅' : '⬜'} Fecha${fecha ? `: ${fecha}` : ''}`);
  lineas.push(`${hora ? '✅' : '⬜'} Hora${hora ? `: ${hora}` : ''}`);
  return lineas.join('\n');
}

// Formatea la lista de servicios de forma fija y exacta (no pasa por IA), para el saludo inicial
function formatearCatalogoServicios(servicios) {
  return servicios.map(s => `• ${s.nombre} — $${s.precio}`).join('\n');
}

module.exports = { construirChecklist, formatearCatalogoServicios };