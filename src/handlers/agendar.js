// Flujo conversacional de agendamiento por slots (no por pasos rígidos): Gemini extrae datos en cualquier orden
const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const { obtenerHorariosLibres } = require('../calendar/disponibilidad');
const { estaDisponible } = require('../db/disponibilidad');
const { generarRespuestaNatural, extraerDatosCita } = require('src/ai/provider.js');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');

module.exports = async function agendar({ texto, numero, sock }) {
  const estadoPrevio = obtenerEstado(numero) || {};

  const { data: servicios } = await supabase.from('servicios').select('*');
  const { data: barberos } = await supabase.from('barberos').select('*').eq('activo', true);

  if (!servicios?.length || !barberos?.length) {
    await sock.sendMessage(numero, { text: 'No hay servicios o barberos configurados por ahora.' });
    return;
  }

  // Extrae de este mensaje cualquier dato nuevo (servicio, barbero, fecha, hora), en cualquier orden/combinación
  const extraido = await extraerDatosCita(texto, estadoPrevio, { servicios, barberos });

  // Combina lo ya sabido con lo nuevo (lo nuevo no vacío sobrescribe)
  const datos = { ...estadoPrevio };
  if (extraido.servicio) datos.servicioNombre = extraido.servicio;
  if (extraido.barbero) datos.barberoNombre = extraido.barbero;
  if (extraido.fecha) datos.fecha = extraido.fecha;
  if (extraido.hora) datos.hora = extraido.hora;

  // Resuelve el servicio y barbero contra el catálogo real (Gemini ya normalizó el nombre)
  const servicio = datos.servicioNombre
    ? servicios.find(s => s.nombre.toLowerCase() === datos.servicioNombre.toLowerCase())
    : null;
  const barbero = datos.barberoNombre
    ? barberos.find(b => b.nombre.toLowerCase() === datos.barberoNombre.toLowerCase())
    : null;

  // Determina qué falta
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

  // Ya están los 4 datos: valida disponibilidad real antes de confirmar
  const disponibilidad = await estaDisponible(barbero.id, datos.fecha, datos.hora);

  if (!disponibilidad.disponible) {
    const libres = await obtenerHorariosLibres(barbero, datos.fecha, servicio.duracion_min);

    // Descarta la hora inválida pero conserva el resto de los datos ya confirmados
    setEstado(numero, { ...datos, hora: null });

    const respuesta = await generarRespuestaNatural({
      tipo: 'horario_no_disponible',
      motivo: disponibilidad.motivo,
      barbero: barbero.nombre,
      alternativas: libres.slice(0, 3),
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
    citaId: data.id,
    barberoId: barbero.id,
    fecha: datos.fecha,
    hora: datos.hora,
    servicioNombre: servicio.nombre,
    duracionMin: servicio.duracion_min,
  });

  limpiarEstado(numero);
  const confirmacion = await generarRespuestaNatural({
    tipo: 'confirmar_cita',
    servicio: servicio.nombre,
    barbero: barbero.nombre,
    fecha: datos.fecha,
    hora: datos.hora,
  });
  await sock.sendMessage(numero, { text: confirmacion });
};