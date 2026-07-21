// Sincroniza citas con Google Calendar
const { google } = require('googleapis');
const { obtenerClienteBarbero } = require('./oauth');
const { supabase } = require('../db/client');
const logger = require('../utils/logger');

// Crea evento en Calendar y guarda el event_id en la cita
async function crearEvento({ citaId, barberoId, barberoNombre, fecha, hora, servicioNombre, duracionMin, sock }) {
  const auth = await obtenerClienteBarbero(barberoId);

  if (!auth) {
    logger.error(`Barbero "${barberoNombre}" (id ${barberoId}) sin OAuth de Calendar configurado. Cita ${citaId} guardada solo en Supabase, NO sincronizada.`);
    await notificarAdminFaltaOAuth({ barberoNombre, barberoId, sock });
    return null;
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const inicio = new Date(`${fecha}T${hora}:00`);
    const fin = new Date(inicio.getTime() + duracionMin * 60000);

    const evento = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `Cita: ${servicioNombre}`,
        start: { dateTime: inicio.toISOString() },
        end: { dateTime: fin.toISOString() },
      },
    });

    await supabase.from('citas').update({ calendar_event_id: evento.data.id }).eq('id', citaId);
    logger.calendar(`Evento creado OK para barbero ${barberoId}, cita ${citaId}`);
    return evento.data.id;
  } catch (err) {
    logger.error(`Fallo creando evento Calendar para barbero ${barberoId}, cita ${citaId}`, err.message);
    return null;
  }
}

// Elimina evento de Calendar al cancelar cita
async function eliminarEvento({ citaId, barberoId }) {
  const { data: cita, error: errorLectura } = await supabase
    .from('citas').select('calendar_event_id').eq('id', citaId).single();

  if (errorLectura) {
    logger.error(`Fallo leyendo cita ${citaId} para eliminar evento`, errorLectura.message);
    return;
  }

  if (!cita?.calendar_event_id) {
    logger.calendar(`Cita ${citaId} no tiene evento de Calendar asociado, nada que borrar`);
    return;
  }

  const auth = await obtenerClienteBarbero(barberoId);
  if (!auth) {
    logger.calendar(`Barbero ${barberoId} sin OAuth configurado, se omite eliminación en Calendar`);
    return;
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId: cita.calendar_event_id });
    logger.calendar(`Evento eliminado OK para barbero ${barberoId}, cita ${citaId}`);
  } catch (err) {
    logger.error(`Fallo eliminando evento Calendar para barbero ${barberoId}, cita ${citaId}`, err.message);
  }
}

// Notifica al primer número admin configurado que un barbero necesita autorizar su Calendar
async function notificarAdminFaltaOAuth({ barberoNombre, barberoId, sock }) {
  const admins = (process.env.ADMIN_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
  if (!admins.length || !sock) return;

  const mensaje = `⚠️ El barbero "${barberoNombre}" (id ${barberoId}) tiene una cita agendada pero NO ha autorizado Google Calendar. Sus citas se están guardando pero no sincronizando. Pídele que visite /oauth/authorize?barbero_id=${barberoId} para conectarlo.`;

  try {
    await sock.sendMessage(admins[0], { text: mensaje });
  } catch (err) {
    logger.error('Fallo notificando a admin sobre falta de OAuth', err.message);
  }
}

module.exports = { crearEvento, eliminarEvento };