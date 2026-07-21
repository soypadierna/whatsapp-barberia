// Flujo guiado de agendamiento: muestra catálogo, checklist visual, y 3 rutas de resolución ante no-disponibilidad
const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const {
  obtenerHorariosLibres, estaDisponible,
  otrasHorasMismoDia, otroDiaMismaHora, otroBarberoMismaFechaHora,
} = require('../calendar/disponibilidad');
const { generarRespuestaNatural, extraerDatosCita } = require('../ai/provider');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');
const { construirChecklist } = require('../utils/checklist');
const logger = require('../utils/logger');

const RUTA_A = /otr[ao]s?\s*hora|otro\s*horario/i;
const RUTA_B = /otro\s*d[ií]a|otra\s*fecha/i;
const RUTA_C = /otro\s*barbero|otra\s*persona|alguien\s*m[aá]s/i;

module.exports = async function agendar({ texto, numero, sock }) {
  const estadoPrevio = obtenerEstado(numero) || {};

  const { data: servicios } = await supabase.from('servicios').select('*');
  const { data: barberos } = await supabase.from('barberos').select('*').eq('activo', true);

  if (!servicios?.length || !barberos?.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios o barberos configurados por ahora.' });
    return;
  }

  const unSoloBarbero = barberos.length === 1;

  // Paso 0: primer mensaje del flujo, muestra el catálogo de servicios explícitamente
  if (!estadoPrevio.iniciado) {
    const listaServicios = servicios.map(s => `${s.nombre} ($${s.precio})`).join(', ');
    setEstado(numero, { iniciado: true, barberoNombre: unSoloBarbero ? barberos[0].nombre : null });

    const respuesta = await generarRespuestaNatural({
      tipo: 'mostrar_catalogo_inicial',
      servicios: servicios.map(s => ({ nombre: s.nombre, precio: s.precio })),
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  // Sub-estado: el bot ofreció las 3 rutas y espera que el cliente elija una explícitamente
  if (estadoPrevio.rutasOfrecidas) {
    const resuelto = await resolverEligiendoRuta({ texto, estadoPrevio, servicios, barberos, numero, sock });
    if (resuelto) return;
    // si no coincide con ninguna ruta explícita, sigue al flujo normal de extracción abajo
  }

  logger.mensaje(`[agendar] fecha en estado antes de extraer: ${estadoPrevio.fecha || 'ninguna'}`);
  const extraido = await extraerDatosCita(texto, estadoPrevio, { servicios, barberos });

  const datos = { ...estadoPrevio, rutasOfrecidas: null };
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

    const respuestaBase = await generarRespuestaNatural({
      tipo: 'pedir_datos_faltantes',
      faltantes,
      mostrarListaBarberos: faltantes.includes('barbero'),
      barberos: barberos.map(b => b.nombre),
    });

    await sock.sendMessage(numero, { text: `${respuestaBase}\n\n${checklist}` });
    return;
  }

  await procesarConfirmacion({ datos: { ...datos, servicioResuelto: servicio, barberoResuelto: barbero }, servicios, barberos, unSoloBarbero, numero, sock });
};

// Cuando el cliente responde a la oferta de 3 rutas con una petición explícita ("otras horas", "otro día", "otro barbero")
async function resolverEligiendoRuta({ texto, estadoPrevio, servicios, barberos, numero, sock }) {
  const { servicioResuelto: servicio, barberoResuelto: barbero, fecha, hora } = estadoPrevio;

  if (RUTA_A.test(texto)) {
    const libres = await otrasHorasMismoDia(barbero, fecha, servicio.duracion_min);
    if (libres.length > 0) {
      setEstado(numero, { ...estadoPrevio, rutasOfrecidas: null, alternativasPendientes: libres });
      const respuesta = await generarRespuestaNatural({ tipo: 'mostrar_otras_horas', barbero: barbero.nombre, opciones: libres.slice(0, 3) });
      await sock.sendMessage(numero, { text: respuesta });
      return true;
    }
  }

  if (RUTA_B.test(texto)) {
    const otroDia = await otroDiaMismaHora(barbero, hora, servicio.duracion_min);
    if (otroDia) {
      setEstado(numero, { ...estadoPrevio, rutasOfrecidas: null, fecha: otroDia.fecha, hora: otroDia.hora });
      return procesarConfirmacion({ datos: { ...estadoPrevio, fecha: otroDia.fecha, hora: otroDia.hora, servicioResuelto: servicio, barberoResuelto: barbero }, servicios, barberos, unSoloBarbero: barberos.length === 1, numero, sock });
    }
  }

  if (RUTA_C.test(texto)) {
    const otro = await otroBarberoMismaFechaHora(barberos, barbero.id, fecha, hora, servicio.duracion_min);
    if (otro) {
      return procesarConfirmacion({ datos: { ...estadoPrevio, servicioResuelto: servicio, barberoResuelto: otro.barbero, barberoNombre: otro.barbero.nombre }, servicios, barberos, unSoloBarbero: barberos.length === 1, numero, sock });
    }
  }

  return false; // no coincidió con ninguna ruta explícita con opciones reales
}

async function procesarConfirmacion({ datos, servicios, barberos, unSoloBarbero, numero, sock }) {
  const servicio = datos.servicioResuelto || servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase());
  const barbero = datos.barberoResuelto || barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase());

  const disponibilidad = await estaDisponible(barbero.id, datos.fecha, datos.hora);

  if (!disponibilidad.disponible) {
    // Calcula las 3 rutas en paralelo para ofrecerlas juntas
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
      // Punto 4: ninguna ruta directa funciona, combina criterios más amplios
      const respuesta = await generarRespuestaNatural({ tipo: 'sin_disponibilidad_general', barbero: barbero.nombre });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    const respuesta = await generarRespuestaNatural({
      tipo: 'ofrecer_tres_rutas',
      motivo: disponibilidad.motivo,
      barbero: barbero.nombre,
      rutaA: rutaA.length > 0 ? rutaA.slice(0, 3) : null,
      rutaB: rutaB || null,
      rutaC: rutaC ? rutaC.barbero.nombre : null,
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

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
    citaId: data.id,
    barberoId: barbero.id,
    barberoNombre: barbero.nombre,
    fecha: datos.fecha,
    hora: datos.hora,
    servicioNombre: servicio.nombre,
    duracionMin: servicio.duracion_min,
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