// Crea una cita validando disponibilidad del barbero
const { supabase } = require('../db/client');
const { estaDisponible } = require('../db/disponibilidad');
const { crearEvento } = require('../calendar/sync');

module.exports = async function agendar({ texto, numero, sock }) {
  const partes = texto.split(' ');

  if (partes.length < 5) {
    await sock.sendMessage(numero, {
      text: 'Para agendar escribe:\nagendar [barbero] [servicio] [fecha YYYY-MM-DD] [hora HH:MM]',
    });
    return;
  }

  const [, nombreBarbero, nombreServicio, fecha, hora] = partes;

  const { data: barbero } = await supabase
    .from('barberos').select('id').ilike('nombre', nombreBarbero).single();
  const { data: servicio } = await supabase
    .from('servicios').select('id').ilike('nombre', nombreServicio).single();

  if (!barbero || !servicio) {
    await sock.sendMessage(numero, { text: 'Barbero o servicio no encontrado.' });
    return;
  }

  const disponibilidad = await estaDisponible(barbero.id, fecha, hora);
  if (!disponibilidad.disponible) {
    await sock.sendMessage(numero, { text: `No se pudo agendar: ${disponibilidad.motivo}` });
    return;
  }

  const { error } = await supabase.from('citas').insert({
    barbero_id: barbero.id,
    cliente_telefono: numero,
    servicio_id: servicio.id,
    fecha,
    hora,
    estado: 'pendiente',
  });

  if (error) {
    await sock.sendMessage(numero, { text: 'Error al agendar la cita.' });
    return;
  }

  await crearEvento({
    citaId: data.id, // requiere .select().single() en el insert
    barberoId: barbero.id,
    fecha, hora,
    servicioNombre: nombreServicio,
    duracionMin: 30, // o traerlo de la tabla servicios
  });

  await sock.sendMessage(numero, { text: `Cita agendada con ${nombreBarbero} el ${fecha} a las ${hora} ✅` });
};