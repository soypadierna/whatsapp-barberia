// Flujo conversacional de agendamiento paso a paso
const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const { obtenerHorariosLibres } = require('../calendar/disponibilidad');
const { generarRespuestaNatural, interpretarSeleccion } = require('../ai/gemini');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');


module.exports = async function agendar({ texto, numero, sock }) {
  const estado = obtenerEstado(numero);

  // Paso 0: inicia el flujo, muestra servicios disponibles
  if (!estado) {
    const { data: servicios, error } = await supabase.from('servicios').select('*');

    if (error) {
      console.log('ERROR leyendo servicios:', error.message);
    }

    if (!servicios?.length) {
      await sock.sendMessage(numero, { text: 'No hay servicios disponibles por ahora.' });
      return;
    }

    const lista = servicios.map((s, i) => `${i + 1}. ${s.nombre} - $${s.precio}`).join('\n');
    setEstado(numero, { paso: 'servicio', servicios });

    await sock.sendMessage(numero, {
      text: `¿Qué servicio te gustaría agendar?\n${lista}\n\nResponde con el número o el nombre.`,
    });
    return;
  }

// Paso 1: elige servicio, muestra barberos disponibles
  if (estado.paso === 'servicio') {
    const servicio = await interpretarSeleccion(texto, estado.servicios);

    if (!servicio) {
      await sock.sendMessage(numero, { text: 'No reconocí ese servicio. ¿Puedes escribirlo de nuevo o el número de la lista?' });
      return;
    }

    const { data: barberos } = await supabase.from('barberos').select('*').eq('activo', true);
    const lista = barberos.map((b, i) => `${i + 1}. ${b.nombre} (${b.horario_inicio} - ${b.horario_fin})`).join('\n');

    setEstado(numero, { paso: 'barbero', servicio, barberos });
    await sock.sendMessage(numero, { text: `¿Con qué barbero prefieres?\n${lista}\n\nResponde con el número o el nombre.` });
    return;
  }

// Paso 2: elige barbero, pide fecha
  if (estado.paso === 'barbero') {
    const barbero = await interpretarSeleccion(texto, estado.barberos);

    if (!barbero) {
      await sock.sendMessage(numero, { text: 'No reconocí ese barbero. ¿Puedes escribirlo de nuevo o el número de la lista?' });
      return;
    }

    setEstado(numero, { ...estado, paso: 'fecha', barbero });
    await sock.sendMessage(numero, { text: '¿Para qué fecha? (formato: YYYY-MM-DD, ej. 2026-07-20)' });
    return;
  }

  // Paso 3: recibe fecha, muestra disponibilidad real en lenguaje natural
  if (estado.paso === 'fecha') {
    const fecha = texto.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      await sock.sendMessage(numero, { text: 'Formato inválido. Usa YYYY-MM-DD, ej. 2026-07-20' });
      return;
    }

    const { barbero, servicio } = estado;
    const libres = await obtenerHorariosLibres(barbero, fecha, servicio.duracion_min);

    if (!libres.length) {
      await sock.sendMessage(numero, { text: `${barbero.nombre} no tiene espacio ese día. ¿Probamos con otra fecha?` });
      return; // se queda en el mismo paso para reintentar con otra fecha
    }

    const opciones = libres.slice(0, 3);
    const respuesta = await generarRespuestaNatural({
      tipo: 'mostrar_disponibilidad',
      barbero: barbero.nombre,
      fecha,
      opciones,
    });

    setEstado(numero, { ...estado, paso: 'hora', fecha, opciones });
    await sock.sendMessage(numero, { text: respuesta });
    return;
  }

  // Paso 4: recibe hora (libre, cualquier formato HH:MM), valida disponibilidad real antes de confirmar
  if (estado.paso === 'hora') {
    const { servicio, barbero, fecha } = estado;
    const horaMatch = texto.match(/\d{1,2}:\d{2}/);
    const hora = horaMatch ? horaMatch[0].padStart(5, '0') : null;

    if (!hora) {
      await sock.sendMessage(numero, { text: 'No entendí la hora. Escríbela en formato HH:MM, ej. 15:00' });
      return;
    }

    const disponibilidad = await estaDisponible(barbero.id, fecha, hora);

    if (!disponibilidad.disponible) {
      const libres = await obtenerHorariosLibres(barbero, fecha, servicio.duracion_min);
      const respuesta = await generarRespuestaNatural({
        tipo: 'horario_no_disponible',
        motivo: disponibilidad.motivo,
        barbero: barbero.nombre,
        alternativas: libres.slice(0, 3),
      });
      await sock.sendMessage(numero, { text: respuesta });
      return; // se queda en el mismo paso para que elija otra hora
    }

    const { data, error } = await supabase
      .from('citas')
      .insert({
        barbero_id: barbero.id,
        cliente_telefono: numero,
        servicio_id: servicio.id,
        fecha,
        hora,
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
      fecha, hora,
      servicioNombre: servicio.nombre,
      duracionMin: servicio.duracion_min,
    });

    limpiarEstado(numero);
    const confirmacion = await generarRespuestaNatural({
      tipo: 'confirmar_cita',
      servicio: servicio.nombre,
      barbero: barbero.nombre,
      fecha, hora,
    });
    await sock.sendMessage(numero, { text: confirmacion });
    return;
  }
};