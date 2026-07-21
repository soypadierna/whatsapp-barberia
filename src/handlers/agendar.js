// Flujo guiado de agendamiento: catálogo inicial, checklist, 3 rutas de disponibilidad, confirmación final antes de guardar
const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const {
  obtenerHorariosLibres, estaDisponible,
  otrasHorasMismoDia, otroDiaMismaHora, otroBarberoMismaFechaHora,
} = require('../calendar/disponibilidad');
const { generarRespuestaNatural, extraerDatosCita, interpretarConfirmacion } = require('../ai/provider');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');
const { construirChecklist } = require('../utils/checklist');
const logger = require('../utils/logger');

const RUTA_A = /otr[ao]s?\s*hora|otro\s*horario/i;
const RUTA_B = /otro\s*d[ií]a|otra\s*fecha/i;
const RUTA_C = /otro\s*barbero|otra\s*persona|alguien\s*m[aá]s/i;
const AFIRMACIONES = /^(si|sí|dale|ok|vale|de una|correcto|confirmo|👍)/i;
const NEGACIONES = /^(no|cambiar|espera|mejor)/i;

module.exports = async function agendar({ texto, numero, sock }) {
  const estadoPrevio = obtenerEstado(numero) || {};

  const { data: servicios } = await supabase.from('servicios').select('*');
  const { data: barberos } = await supabase.from('barberos').select('*').eq('activo', true);

  if (!servicios?.length || !barberos?.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios o barberos configurados por ahora.' });
    return;
  }

  const unSoloBarbero = barberos.length === 1;

  // Sub-estado: esperando confirmación final antes de guardar
  if (estadoPrevio.esperandoConfirmacionFinal) {
    const resultado = await interpretarConfirmacion(texto, {
      servicio: estadoPrevio.servicioNombre, barbero: estadoPrevio.barberoNombre,
      fecha: estadoPrevio.fecha, hora: estadoPrevio.hora,
    });

    if (resultado.accion === 'confirmar') {
      return guardarCita({ datos: estadoPrevio, servicios, barberos, unSoloBarbero, numero, sock });
    }

    if (resultado.accion === 'cancelar') {
      limpiarEstado(numero);
      const respuesta = await generarRespuestaNatural({ tipo: 'cita_cancelada_por_cliente' });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    if (resultado.accion === 'cambiar' && resultado.campo) {
      const datosActualizados = { ...estadoPrevio, esperandoConfirmacionFinal: false };

      // Reutiliza extraerDatosCita para interpretar el nuevo valor mencionado (mismo parser que ya funciona bien)
      const extraidoCambio = await extraerDatosCita(resultado.valorNuevo || texto, {}, { servicios, barberos });

      if (resultado.campo === 'servicio' && extraidoCambio.servicio) datosActualizados.servicioNombre = extraidoCambio.servicio;
      if (resultado.campo === 'barbero' && extraidoCambio.barbero) datosActualizados.barberoNombre = extraidoCambio.barbero;
      if (resultado.campo === 'fecha' && extraidoCambio.fecha) datosActualizados.fecha = extraidoCambio.fecha;
      if (resultado.campo === 'hora' && extraidoCambio.hora) datosActualizados.hora = extraidoCambio.hora;

      const servicioNuevo = servicios.find(s => s.nombre.toLowerCase() === datosActualizados.servicioNombre?.toLowerCase());
      const barberoNuevo = barberos.find(b => b.nombre.toLowerCase() === datosActualizados.barberoNombre?.toLowerCase());

      return procesarConfirmacion({
        datos: { ...datosActualizados, servicioResuelto: servicioNuevo, barberoResuelto: barberoNuevo },
        servicios, barberos, unSoloBarbero, numero, sock,
      });
    }

    // no_claro: repite la pregunta de confirmación sin resetear el estado (nunca se pierde la cita)
    setEstado(numero, estadoPrevio); // mantiene el estado intacto explícitamente
    const checklist = construirChecklist({
      servicio: estadoPrevio.servicioNombre, barbero: estadoPrevio.barberoNombre,
      fecha: estadoPrevio.fecha, hora: estadoPrevio.hora, mostrarBarbero: !unSoloBarbero,
    });
    const respuesta = await generarRespuestaNatural({ tipo: 'repetir_confirmacion_no_claro' });
    await sock.sendMessage(numero, { text: `${respuesta}\n\n${checklist}` });
    return;
  }

  // Sub-estado: el bot ofreció las 3 rutas y espera que el cliente elija una explícitamente
  if (estadoPrevio.rutasOfrecidas) {
    const resuelto = await resolverEligiendoRuta({ texto, estadoPrevio, servicios, barberos, unSoloBarbero, numero, sock });
    if (resuelto) return;
  }

  logger.mensaje(`[agendar] fecha en estado antes de extraer: ${estadoPrevio.fecha || 'ninguna'}`);
  const extraido = await extraerDatosCita(texto, estadoPrevio, { servicios, barberos });
  logger.mensaje(`[agendar] fecha extraída este turno: ${extraido.fecha || 'ninguna'}`);

  const datos = { ...estadoPrevio, iniciado: true, rutasOfrecidas: null, esperandoConfirmacionFinal: false };
  if (extraido.servicio) datos.servicioNombre = extraido.servicio;
  if (extraido.barbero) datos.barberoNombre = extraido.barbero;
  if (extraido.fecha) datos.fecha = extraido.fecha;
  if (extraido.hora) datos.hora = extraido.hora;

  const servicio = datos.servicioNombre ? servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase()) : null;
  const barbero = datos.barberoNombre ? barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase()) : (unSoloBarbero ? barberos[0] : null);
  if (barbero) datos.barberoNombre = barbero.nombre;

  const faltantes = [];
  if (!servicio) faltantes.push('servicio');
  if (!unSoloBarbero && !barbero) faltantes.push('barbero');
  if (!datos.fecha) faltantes.push('fecha');
  if (!datos.hora) faltantes.push('hora');

  if (faltantes.length > 0) {
    setEstado(numero, datos);

    const checklist = construirChecklist({
      servicio: servicio?.nombre, barbero: barbero?.nombre, fecha: datos.fecha, hora: datos.hora,
      mostrarBarbero: !unSoloBarbero,
    });

    const esPrimerMensaje = !estadoPrevio.iniciado;
    const respuestaBase = await generarRespuestaNatural({
      tipo: esPrimerMensaje && !servicio ? 'mostrar_catalogo_inicial' : 'pedir_datos_faltantes',
      faltantes,
      servicios: servicios.map(s => ({ nombre: s.nombre, precio: s.precio })),
      mostrarListaBarberos: faltantes.includes('barbero'),
      barberos: barberos.map(b => b.nombre),
    });

    await sock.sendMessage(numero, { text: `${respuestaBase}\n\n${checklist}` });
    return;
  }

  await procesarConfirmacion({ datos: { ...datos, servicioResuelto: servicio, barberoResuelto: barbero }, servicios, barberos, unSoloBarbero, numero, sock });
};

async function resolverEligiendoRuta({ texto, estadoPrevio, servicios, barberos, unSoloBarbero, numero, sock }) {
  const { servicioResuelto: servicio, barberoResuelto: barbero, fecha, hora } = estadoPrevio;

  if (RUTA_A.test(texto)) {
    const libres = await otrasHorasMismoDia(barbero, fecha, servicio.duracion_min);
    if (libres.length > 0) {
      setEstado(numero, { ...estadoPrevio, rutasOfrecidas: null });
      const respuesta = await generarRespuestaNatural({ tipo: 'mostrar_otras_horas', barbero: barbero.nombre, opciones: libres.slice(0, 3) });
      await sock.sendMessage(numero, { text: respuesta });
      return true;
    }
  }

  if (RUTA_B.test(texto)) {
    const otroDia = await otroDiaMismaHora(barbero, hora, servicio.duracion_min);
    if (otroDia) {
      return procesarConfirmacion({ datos: { ...estadoPrevio, fecha: otroDia.fecha, hora: otroDia.hora, servicioResuelto: servicio, barberoResuelto: barbero }, servicios, barberos, unSoloBarbero, numero, sock });
    }
  }

  if (RUTA_C.test(texto)) {
    const otro = await otroBarberoMismaFechaHora(barberos, barbero.id, fecha, hora, servicio.duracion_min);
    if (otro) {
      return procesarConfirmacion({ datos: { ...estadoPrevio, servicioResuelto: servicio, barberoResuelto: otro.barbero, barberoNombre: otro.barbero.nombre }, servicios, barberos, unSoloBarbero, numero, sock });
    }
  }

  return false;
}

// Ya validó disponibilidad OK: en vez de guardar de una vez, pide confirmación final explícita
async function procesarConfirmacion({ datos, servicios, barberos, unSoloBarbero, numero, sock }) {
  const servicio = datos.servicioResuelto || servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase());
  const barbero = datos.barberoResuelto || barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase());

  const disponibilidad = await estaDisponible(barbero.id, datos.fecha, datos.hora);

  if (!disponibilidad.disponible) {
    const [rutaA, rutaB, rutaC] = await Promise.all([
      otrasHorasMismoDia(barbero, datos.fecha, servicio.duracion_min),
      otroDiaMismaHora(barbero, datos.hora, servicio.duracion_min),
      otroBarberoMismaFechaHora(barberos, barbero.id, datos.fecha, datos.hora, servicio.duracion_min),
    ]);

    const hayAlgunaRuta = rutaA.length > 0 || rutaB || rutaC;

    setEstado(numero, {
      ...datos, hora: null,
      servicioResuelto: servicio, barberoResuelto: barbero,
      rutasOfrecidas: hayAlgunaRuta,
    });

    if (!hayAlgunaRuta) {
      const respuesta = await generarRespuestaNatural({ tipo: 'sin_disponibilidad_general', barbero: barbero.nombre });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    const respuesta = await generarRespuestaNatural({
      tipo: 'ofrecer_tres_rutas', motivo: disponibilidad.motivo, barbero: barbero.nombre,
      rutaA: rutaA.length > 0 ? rutaA.slice(0, 3) : null,
      rutaB: rutaB || null,
      rutaC: rutaC ? rutaC.barbero.nombre : null,
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  // Disponible: pide confirmación explícita antes de guardar (punto 4)
  setEstado(numero, {
    ...datos, servicioResuelto: servicio, barberoResuelto: barbero,
    servicioNombre: servicio.nombre, barberoNombre: barbero.nombre,
    esperandoConfirmacionFinal: true,
  });

  const checklist = construirChecklist({
    servicio: servicio.nombre, barbero: barbero.nombre, fecha: datos.fecha, hora: datos.hora,
    mostrarBarbero: !unSoloBarbero,
  });

  const respuesta = await generarRespuestaNatural({
    tipo: 'confirmar_antes_de_guardar',
    servicio: servicio.nombre, barbero: barbero.nombre, fecha: datos.fecha, hora: datos.hora,
  });
  await sock.sendMessage(numero, { text: `${respuesta}\n\n${checklist}` });
}

// Solo aquí se guarda realmente la cita, tras confirmación explícita del cliente
async function guardarCita({ datos, servicios, barberos, unSoloBarbero, numero, sock }) {
  const servicio = datos.servicioResuelto;
  const barbero = datos.barberoResuelto;

  const { data, error } = await supabase
    .from('citas')
    .insert({
      barbero_id: barbero.id, cliente_telefono: numero, servicio_id: servicio.id,
      fecha: datos.fecha, hora: datos.hora, estado: 'pendiente',
    })
    .select()
    .single();

  if (error) {
    await sock.sendMessage(numero, { text: 'Ocurrió un error al agendar. Intenta de nuevo más tarde.' });
    limpiarEstado(numero);
    return;
  }

  await crearEvento({
    citaId: data.id, barberoId: barbero.id, barberoNombre: barbero.nombre,
    fecha: datos.fecha, hora: datos.hora,
    servicioNombre: servicio.nombre, duracionMin: servicio.duracion_min,
    sock,
  });

  limpiarEstado(numero);

  const checklist = construirChecklist({
    servicio: servicio.nombre, barbero: barbero.nombre, fecha: datos.fecha, hora: datos.hora,
    mostrarBarbero: !unSoloBarbero,
  });

  const confirmacion = await generarRespuestaNatural({
    tipo: 'confirmar_cita', servicio: servicio.nombre, barbero: barbero.nombre, fecha: datos.fecha, hora: datos.hora,
  });
  await sock.sendMessage(numero, { text: `${confirmacion}\n\n${checklist}` });
}