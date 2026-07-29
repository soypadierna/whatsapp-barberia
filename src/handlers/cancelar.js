// Maneja cancelación y modificación de citas ya confirmadas
const { supabase } = require('../db/client');
const { buscarCitasFuturas } = require('../db/citas');
const { eliminarEvento, moverEvento } = require('../calendar/sync');
const { estaDisponible } = require('../calendar/disponibilidad');
const { extraerDatosCita, generarRespuestaNatural, interpretarConfirmacion } = require('../ai/provider');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');
const logger = require('../utils/logger');

module.exports = async function cancelar({ texto, numero, sock }) {
  const estadoPrevio = obtenerEstado(numero) || {};

  // Sub-estado: ya se identificó la cita y se está esperando qué cambiar o confirmación de cancelar
  if (estadoPrevio.citaSeleccionadaId) {
    return manejarAccionSobreCita({ texto, estadoPrevio, numero, sock });
  }

  const citas = await buscarCitasFuturas(numero);

  if (!citas.length) {
    await sock.sendMessage(numero, { text: 'No encontré citas próximas a tu nombre para cancelar o modificar.' });
    return;
  }

  if (citas.length === 1) {
    const cita = citas[0];
    setEstado(numero, {
      flujo: 'cancelar', citaSeleccionadaId: cita.id,
      citaInfo: { fecha: cita.fecha, hora: cita.hora.slice(0,5), servicio: cita.servicios.nombre, barbero: cita.barberos.nombre, barberoId: cita.barbero_id, servicioId: cita.servicio_id, duracionMin: cita.servicios.duracion_min },
    });
    const respuesta = await generarRespuestaNatural({
      tipo: 'preguntar_cancelar_o_modificar',
      cita: { servicio: cita.servicios.nombre, barbero: cita.barberos.nombre, fecha: cita.fecha, hora: cita.hora.slice(0,5) },
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  // Varias citas: pide identificar cuál (por fecha simple, o la más próxima si el mensaje no aclara)
  const lista = citas.map((c, i) => `${i + 1}. ${c.servicios.nombre} con ${c.barberos.nombre} — ${c.fecha} ${c.hora.slice(0,5)}`).join('\n');
  setEstado(numero, { flujo: 'cancelar', eligiendoCita: true, citasDisponibles: citas });
  await sock.sendMessage(numero, { text: `Tienes varias citas próximas:\n\n${lista}\n\n¿Cuál quieres cancelar o modificar? (dime el número)` });
};

async function manejarAccionSobreCita({ texto, estadoPrevio, numero, sock }) {
  // Si está eligiendo entre varias citas
  if (estadoPrevio.eligiendoCita) {
    const idx = parseInt(texto.trim()) - 1;
    const cita = estadoPrevio.citasDisponibles?.[idx];
    if (!cita) {
      await sock.sendMessage(numero, { text: 'No reconocí ese número. Dime cuál de la lista (1, 2, 3...).' });
      return;
    }
    setEstado(numero, {
      flujo: 'cancelar', citaSeleccionadaId: cita.id,
      citaInfo: { fecha: cita.fecha, hora: cita.hora.slice(0,5), servicio: cita.servicios.nombre, barbero: cita.barberos.nombre, barberoId: cita.barbero_id, servicioId: cita.servicio_id, duracionMin: cita.servicios.duracion_min },
    });
    const respuesta = await generarRespuestaNatural({ tipo: 'preguntar_cancelar_o_modificar', cita: cita.citaInfo });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  const { citaSeleccionadaId, citaInfo } = estadoPrevio;

  // Sub-estado: pidió cambiar algo, espera nuevo dato
  if (estadoPrevio.esperandoNuevoDato) {
    const extraido = await extraerDatosCita(texto, {}, { servicios: [{ nombre: citaInfo.servicio }], barberos: [{ nombre: citaInfo.barbero }] });
    const nuevaFecha = extraido.fecha || citaInfo.fecha;
    const nuevaHora = extraido.hora || citaInfo.hora;

    if (!extraido.fecha && !extraido.hora) {
      await sock.sendMessage(numero, { text: '¿Para qué fecha y hora quieres moverla?' });
      return;
    }

    const disponibilidad = await estaDisponible(citaInfo.barberoId, nuevaFecha, nuevaHora);
    if (!disponibilidad.disponible) {
      await sock.sendMessage(numero, { text: `Ese horario no está disponible (${disponibilidad.motivo}). ¿Otra fecha/hora?` });
      return;
    }

    await supabase.from('citas').update({ fecha: nuevaFecha, hora: nuevaHora }).eq('id', citaSeleccionadaId);
    await moverEvento({ citaId: citaSeleccionadaId, barberoId: citaInfo.barberoId, fecha: nuevaFecha, hora: nuevaHora, duracionMin: citaInfo.duracionMin });

    limpiarEstado(numero);
    const respuesta = await generarRespuestaNatural({ tipo: 'cita_modificada', fecha: nuevaFecha, hora: nuevaHora, servicio: citaInfo.servicio, barbero: citaInfo.barbero });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  // Interpreta si quiere cancelar, modificar, o no quedó claro
  const resultado = await interpretarConfirmacion(texto, { accionesPosibles: 'cancelar o modificar', cita: citaInfo });

  if (/cancel/i.test(texto) || resultado.accion === 'cancelar') {
    await supabase.from('citas').update({ estado: 'cancelada' }).eq('id', citaSeleccionadaId);
    await eliminarEvento({ citaId: citaSeleccionadaId, barberoId: citaInfo.barberoId });

    limpiarEstado(numero);
    const respuesta = await generarRespuestaNatural({ tipo: 'cita_cancelada_confirmado', servicio: citaInfo.servicio, fecha: citaInfo.fecha, hora: citaInfo.hora });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  if (/modific|cambiar|mover/i.test(texto)) {
    setEstado(numero, { ...estadoPrevio, esperandoNuevoDato: true });
    await sock.sendMessage(numero, { text: '¿Para qué nueva fecha y/o hora quieres moverla?' });
    return;
  }

  await sock.sendMessage(numero, { text: '¿Quieres cancelar la cita o cambiarla de fecha/hora?' });
}