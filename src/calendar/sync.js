// Sincroniza citas con Google Calendar
const { google } = require('googleapis');
const { obtenerClienteBarbero } = require('./oauth');
const { supabase } = require('../db/client');

// Crea evento en Calendar y guarda el event_id en la cita
async function crearEvento({ citaId, barberoId, fecha, hora, servicioNombre, duracionMin }) {
  const auth = await obtenerClienteBarbero(barberoId);
  if (!auth) return null;

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
  return evento.data.id;
}

// Elimina evento de Calendar al cancelar cita
async function eliminarEvento({ citaId, barberoId }) {
  const { data: cita } = await supabase
    .from('citas').select('calendar_event_id').eq('id', citaId).single();

  if (!cita?.calendar_event_id) return;

  const auth = await obtenerClienteBarbero(barberoId);
  if (!auth) return;

  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId: cita.calendar_event_id });
}

module.exports = { crearEvento, eliminarEvento };