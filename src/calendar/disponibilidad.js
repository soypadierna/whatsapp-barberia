// Calcula horarios libres reales de un barbero cruzando su horario, Google Calendar y citas en Supabase
const { google } = require('googleapis');
const { obtenerClienteBarbero } = require('./oauth');
const { supabase } = require('../db/client');

// Genera slots candidatos cada `duracionMin` minutos dentro del horario del barbero
function generarSlots(horaInicio, horaFin, duracionMin) {
  const slots = [];
  let [h, m] = horaInicio.split(':').map(Number);
  const [hFin, mFin] = horaFin.split(':').map(Number);

  while (h < hFin || (h === hFin && m < mFin)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += duracionMin;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

// Devuelve los horarios libres de un barbero para una fecha, ya cruzados con Calendar y Supabase
async function obtenerHorariosLibres(barbero, fecha, duracionMin) {
  const slots = generarSlots(barbero.horario_inicio, barbero.horario_fin, duracionMin);

  // Excluye horas ya ocupadas en Supabase (citas pendientes)
  const { data: citas } = await supabase
    .from('citas')
    .select('hora')
    .eq('barbero_id', barbero.id)
    .eq('fecha', fecha)
    .eq('estado', 'pendiente');

  const ocupadasSupabase = new Set((citas || []).map(c => c.hora.slice(0, 5)));

  // Excluye horas ocupadas en Google Calendar (si el barbero ya conectó OAuth)
  let ocupadasCalendar = new Set();
  const auth = await obtenerClienteBarbero(barbero.id);

  if (auth) {
    const calendar = google.calendar({ version: 'v3', auth });
    const inicio = new Date(`${fecha}T00:00:00`);
    const fin = new Date(`${fecha}T23:59:59`);

    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicio.toISOString(),
        timeMax: fin.toISOString(),
        items: [{ id: 'primary' }],
      },
    });

    const busy = res.data.calendars.primary.busy || [];
    for (const b of busy) {
      const hInicio = new Date(b.start).toTimeString().slice(0, 5);
      ocupadasCalendar.add(hInicio);
    }
  }

  return slots.filter(s => !ocupadasSupabase.has(s) && !ocupadasCalendar.has(s));
}

module.exports = { obtenerHorariosLibres };