const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const { obtenerHorariosLibres, sugerirAlternativasAmplias, estaDisponible } = require('../calendar/disponibilidad');
const { generarRespuestaNatural, extraerDatosCita } = require('../ai/provider');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');
const logger = require('../utils/logger');

const AFIRMACIONES = /^(si|sí|dale|ok|vale|de una|me parece|esta bien|está bien|perfecto|👍)/i;

module.exports = async function agendar({ texto, numero, sock }) {
  const estadoPrevio = obtenerEstado(numero) || {};

  const { data: servicios } = await supabase.from('servicios').select('*');
  const { data: barberos } = await supabase.from('barberos').select('*').eq('activo', true);

  if (!servicios?.length || !barberos?.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios o barberos configurados por ahora.' });
    return;
  }

  // Sub-estado: el bot ya ofreció alternativas de horario y espera que el cliente elija una
  if (estadoPrevio.alternativas?.length) {
    const horaMatch = texto.match(/\d{1,2}:\d{2}/);
    const horaElegida = horaMatch ? horaMatch[0].padStart(5, '0') : null;

    if (horaElegida && estadoPrevio.alternativas.includes(horaElegida)) {
      // Cliente eligió una hora válida de las ofrecidas: continúa con esos datos (incluye fecha/barbero de la alternativa)
      const datos = {
        ...estadoPrevio,
        hora: horaElegida,
        fecha: estadoPrevio.fechaAlternativa || estadoPrevio.fecha,
        barberoNombre: estadoPrevio.barberoAlternativo || estadoPrevio.barberoNombre,
        alternativas: null, fechaAlternativa: null, barberoAlternativo: null,
      };
      return procesarConfirmacion({ datos, servicios, barberos, numero, sock });
    }

    if (AFIRMACIONES.test(texto.trim())) {
      // Afirmación genérica sin especificar cuál: pide que elija explícitamente
      const respuesta = await generarRespuestaNatural({
        tipo: 'pedir_cual_alternativa',
        opciones: estadoPrevio.alternativas,
      });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    // No coincide con ninguna alternativa ofrecida ni es afirmación: cae al flujo normal de extracción abajo
  }

  logger.mensaje(`[agendar] fecha en estado antes de extraer: ${estadoPrevio.fecha || 'ninguna'}`);

  const extraido = await extraerDatosCita(texto, estadoPrevio, { servicios, barberos });

  logger.mensaje(`[agendar] fecha extraída este turno: ${extraido.fecha || 'ninguna (no mencionada)'}`);

  const datos = { ...estadoPrevio, alternativas: null, fechaAlternativa: null, barberoAlternativo: null };
  if (extraido.servicio) datos.servicioNombre = extraido.servicio;
  if (extraido.barbero) datos.barberoNombre = extraido.barbero;
  if (extraido.fecha) datos.fecha = extraido.fecha; // solo se sobrescribe si el modelo la marcó como mencionada este turno
  if (extraido.hora) datos.hora = extraido.hora;

  logger.mensaje(`[agendar] fecha final en estado tras merge: ${datos.fecha || 'ninguna'}`);

  const servicio = datos.servicioNombre ? servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase()) : null;
  const barbero = datos.barberoNombre ? barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase()) : null;

  const faltantes = [];
  if (!servicio) faltantes.push('servicio');
  if (!barbero) faltantes.push('barbero');
  if (!datos.fecha) faltantes.push('fecha');
  if (!datos.hora) faltantes.push('hora');

  if (faltantes.length > 0) {
    setEstado(numero, datos);
    const respuesta = await generarRespuestaNatural({
      tipo: 'pedir_datos_faltantes',
      faltantes,
      datosYaConocidos: { servicio: servicio?.nombre, barbero: barbero?.nombre, fecha: datos.fecha, hora: datos.hora },
      servicios: servicios.map(s => ({ nombre: s.nombre, precio: s.precio })),
      barberos: barberos.map(b => b.nombre),
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  await procesarConfirmacion({ datos: { ...datos, servicioResuelto: servicio, barberoResuelto: barbero }, servicios, barberos, numero, sock });
};

async function procesarConfirmacion({ datos, servicios, barberos, numero, sock }) {
  const servicio = datos.servicioResuelto || servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase());
  const barbero = datos.barberoResuelto || barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase());

  const disponibilidad = await estaDisponible(barbero.id, datos.fecha, datos.hora);

  if (!disponibilidad.disponible) {
    const sugerencia = await sugerirAlternativasAmplias({
      barbero, barberosTodos: barberos, fecha: datos.fecha, hora: datos.hora, duracionMin: servicio.duracion_min,
    });

    if (sugerencia.tipo === 'sin_opciones') {
      setEstado(numero, { ...datos, hora: null });
      const respuesta = await generarRespuestaNatural({ tipo: 'sin_disponibilidad_general', barbero: barbero.nombre });
      await sock.sendMessage(numero, { text: respuesta });
      return;
    }

    setEstado(numero, {
      ...datos, hora: null,
      alternativas: sugerencia.opciones,
      fechaAlternativa: sugerencia.fecha,
      barberoAlternativo: sugerencia.barbero,
    });

    const respuesta = await generarRespuestaNatural({
      tipo: 'horario_no_disponible',
      motivo: disponibilidad.motivo,
      sugerenciaTipo: sugerencia.tipo, // usado por el prompt para variar redacción según el caso
      barberoSugerido: sugerencia.barbero,
      fechaSugerida: sugerencia.fecha,
      opciones: sugerencia.opciones,
    });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  const { data, error } = await supabase
    .from('citas')
    .insert({
      barbero_id: barbero.id,
      cliente_telefono: numero,
      servicio_id: servicio.id,
      fecha: datos.fecha,
      hora: datos.hora,
      estado: 'pendiente',
    })
    .select()
    .single();

  if (error) {
    await sock.sendMessage(numero, { text: 'Ocurrió un error al agendar. Intenta de nuevo más tarde.' });
    limpiarEstado(numero);
    return;
  }

  await crearEvento({
    citaId: data.id, barberoId: barbero.id,
    fecha: datos.fecha, hora: datos.hora,
    servicioNombre: servicio.nombre, duracionMin: servicio.duracion_min,
  });

  limpiarEstado(numero);
  const confirmacion = await generarRespuestaNatural({
    tipo: 'confirmar_cita',
    servicio: servicio.nombre, barbero: barbero.nombre,
    fecha: datos.fecha, hora: datos.hora,
  });
  await sock.sendMessage(numero, { text: confirmacion });
}