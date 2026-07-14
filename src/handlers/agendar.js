// Flujo conversacional de agendamiento paso a paso
const { supabase } = require('../db/client');
const { crearEvento } = require('../calendar/sync');
const { obtenerHorariosLibres } = require('../calendar/disponibilidad');
const { generarRespuestaNatural } = require('../ai/gemini');
const { obtenerEstado, setEstado, limpiarEstado } = require('../core/estadoConversacion');

module.exports = async function agendar({ texto, numero, sock }) {
  const estado = obtenerEstado(numero);

  // Paso 0: inicia el flujo, muestra servicios disponibles
  if (!estado) {
    const { data: servicios } = await supabase.from('servicios').select('*');

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
    const servicio = encontrarPorNumeroONombre(texto, estado.servicios, 'nombre');

    if (!servicio) {
      await sock.sendMessage(numero, { text: 'No reconocí ese servicio. Intenta de nuevo con el número o nombre exacto.' });
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
    const barbero = encontrarPorNumeroONombre(texto, estado.barberos, 'nombre');

    if (!barbero) {
      await sock.sendMessage(numero, { text: 'No reconocí ese barbero. Intenta de nuevo.' });
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

  // Paso 4: recibe hora elegida (de las opciones sugeridas), valida y agenda
  if (estado.paso === 'hora') {
    const { servicio, barbero, fecha, opciones } = estado;
    const horaMatch = texto.match(/\d{1,2}:\d{2}/);
    const hora = horaMatch ? horaMatch[0].padStart(5, '0') : null;

    if (!hora || !opciones.includes(hora)) {
      await sock.sendMessage(numero, { text: `Elige una de estas horas: ${opciones.join(', ')}` });
      return;
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

// Busca un item por número de lista (ej. "1") o por coincidencia de nombre
function encontrarPorNumeroONombre(texto, lista, campoNombre) {
  const t = texto.trim().toLowerCase();
  const numeroIndex = parseInt(t) - 1;

  if (!isNaN(numeroIndex) && lista[numeroIndex]) return lista[numeroIndex];

  return lista.find(item => item[campoNombre].toLowerCase().includes(t));
}