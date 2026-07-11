// Cancela la última cita pendiente del cliente
const { supabase } = require('../db/client');

module.exports = async function cancelar({ numero, sock }) {
  const { data: cita } = await supabase
    .from('citas')
    .select('id')
    .eq('cliente_telefono', numero)
    .eq('estado', 'pendiente')
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (!cita) {
    await sock.sendMessage(numero, { text: 'No tienes citas pendientes.' });
    return;
  }

  await supabase.from('citas').update({ estado: 'cancelada' }).eq('id', cita.id);
  await sock.sendMessage(numero, { text: 'Tu cita fue cancelada ✅' });
};