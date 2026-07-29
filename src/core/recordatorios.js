// Revisa cada 5 minutos si hay citas a 40 minutos de distancia y envía recordatorio por WhatsApp
const { supabase } = require('../db/client');
const logger = require('../utils/logger');

const INTERVALO_MS = 5 * 60 * 1000; // revisa cada 5 minutos
const VENTANA_MIN = 40; // recordatorio 40 minutos antes

async function revisarYEnviarRecordatorios(sock) {
  try {
    const ahora = new Date();
    const enVentana = new Date(ahora.getTime() + VENTANA_MIN * 60000);

    const fechaHoy = ahora.toISOString().split('T')[0];
    const horaAhora = ahora.toTimeString().slice(0, 5);
    const horaVentana = enVentana.toTimeString().slice(0, 5);

    // Solo revisa citas de hoy (simplifica el cruce de fecha/hora), entre ahora y ahora+40min
    const { data: citas, error } = await supabase
      .from('citas')
      .select('id, hora, cliente_telefono, servicios(nombre), barberos(nombre)')
      .eq('fecha', fechaHoy)
      .eq('estado', 'pendiente')
      .eq('recordatorio_enviado', false)
      .gte('hora', horaAhora)
      .lte('hora', horaVentana);

    if (error) {
      logger.error('Fallo consultando citas para recordatorio', error.message);
      return;
    }

    for (const cita of citas || []) {
      const mensaje = `⏰ Recordatorio: tienes una cita de ${cita.servicios.nombre} con ${cita.barberos.nombre} hoy a las ${cita.hora.slice(0,5)}. ¡Te esperamos!`;

      try {
        await sock.sendMessage(cita.cliente_telefono, { text: mensaje });
        await supabase.from('citas').update({ recordatorio_enviado: true }).eq('id', cita.id);
        logger.mensaje(`Recordatorio enviado para cita ${cita.id}`);
      } catch (err) {
        logger.error(`Fallo enviando recordatorio para cita ${cita.id}`, err.message);
      }
    }
  } catch (err) {
    logger.error('Error no capturado en revisión de recordatorios', err.stack);
  }
}

function iniciarRecordatorios(sock) {
  setInterval(() => revisarYEnviarRecordatorios(sock), INTERVALO_MS);
  logger.conexion('Proceso de recordatorios iniciado (cada 5 min)');
}

module.exports = { iniciarRecordatorios };