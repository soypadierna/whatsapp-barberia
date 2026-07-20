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

module.exports = { construirChecklist };