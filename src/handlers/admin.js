// Comandos de administración por WhatsApp (solo números en whitelist)
const { supabase } = require('../db/client');

// Verifica si el número está en la whitelist de admins
function esAdmin(numero) {
  const admins = (process.env.ADMIN_NUMBERS || '').split(',').map(n => n.trim());
  return admins.includes(numero);
}

// Ver citas del día actual
async function verCitasHoy(numero, sock) {
  const hoy = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('citas')
    .select('hora, cliente_telefono, estado, barberos(nombre), servicios(nombre)')
    .eq('fecha', hoy)
    .order('hora');

  if (error || !data.length) {
    await sock.sendMessage(numero, { text: 'No hay citas para hoy.' });
    return;
  }

  const lista = data
    .map(c => `• ${c.hora} - ${c.barberos.nombre} - ${c.servicios.nombre} - ${c.cliente_telefono} (${c.estado})`)
    .join('\n');

  await sock.sendMessage(numero, { text: `Citas de hoy:\n${lista}` });
}

// Agregar servicio nuevo. Formato: admin agregar servicio [nombre] [precio] [duracion]
async function agregarServicio(texto, numero, sock) {
  const partes = texto.split(' ');
  if (partes.length < 6) {
    await sock.sendMessage(numero, {
      text: 'Formato: admin agregar servicio [nombre] [precio] [duracion_min]',
    });
    return;
  }

  const [, , , nombre, precio, duracion] = partes;

  const { error } = await supabase.from('servicios').insert({
    nombre,
    precio: parseFloat(precio),
    duracion_min: parseInt(duracion),
  });

  await sock.sendMessage(numero, {
    text: error ? 'Error al agregar servicio.' : `Servicio "${nombre}" agregado ✅`,
  });
}

// Bloquear horario de un barbero. Formato: admin bloquear horario [barbero] [fecha] [hora]
async function bloquearHorario(texto, numero, sock) {
  const partes = texto.split(' ');
  if (partes.length < 6) {
    await sock.sendMessage(numero, {
      text: 'Formato: admin bloquear horario [barbero] [fecha YYYY-MM-DD] [hora HH:MM]',
    });
    return;
  }

  const [, , , nombreBarbero, fecha, hora] = partes;

  const { data: barbero } = await supabase
    .from('barberos').select('id').ilike('nombre', nombreBarbero).single();

  if (!barbero) {
    await sock.sendMessage(numero, { text: 'Barbero no encontrado.' });
    return;
  }

  const { error } = await supabase.from('citas').insert({
    barbero_id: barbero.id,
    cliente_telefono: 'BLOQUEO_ADMIN',
    fecha,
    hora,
    estado: 'pendiente',
  });

  await sock.sendMessage(numero, {
    text: error ? 'Error al bloquear horario.' : `Horario ${fecha} ${hora} bloqueado para ${nombreBarbero} ✅`,
  });
}

module.exports = async function admin({ texto, numero, sock }) {
  if (!esAdmin(numero)) {
    await sock.sendMessage(numero, { text: 'No tienes permisos de administrador.' });
    return;
  }

  const t = texto.toLowerCase();

  if (t.includes('ver citas hoy')) return verCitasHoy(numero, sock);
  if (t.includes('agregar servicio')) return agregarServicio(texto, numero, sock);
  if (t.includes('bloquear horario')) return bloquearHorario(texto, numero, sock);

  await sock.sendMessage(numero, {
    text: 'Comandos admin: ver citas hoy / agregar servicio / bloquear horario',
  });
};