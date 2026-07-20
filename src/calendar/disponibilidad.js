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

// Verifica si un barbero está disponible en una fecha/hora específica (horario, choque en Supabase, choque en Calendar)
async function estaDisponible(barberoId, fecha, hora) {
  const { data: barbero } = await supabase
    .from('barberos').select('*').eq('id', barberoId).single();

  if (!barbero) return { disponible: false, motivo: 'Barbero no existe' };

  if (hora < barbero.horario_inicio || hora >= barbero.horario_fin) {
    return { disponible: false, motivo: 'Fuera de horario de atención' };
  }

  const { data: ocupado } = await supabase
    .from('citas')
    .select('id')
    .eq('barbero_id', barberoId)
    .eq('fecha', fecha)
    .eq('hora', hora)
    .eq('estado', 'pendiente')
    .maybeSingle();

  if (ocupado) return { disponible: false, motivo: 'Horario ya ocupado' };

  const auth = await obtenerClienteBarbero(barberoId);
  if (auth) {
    const calendar = google.calendar({ version: 'v3', auth });
    const inicio = new Date(`${fecha}T${hora}:00`);
    const fin = new Date(inicio.getTime() + 30 * 60000); // ventana mínima de 30 min para chequear choque

    const res = await calendar.freebusy.query({
      requestBody: { timeMin: inicio.toISOString(), timeMax: fin.toISOString(), items: [{ id: 'primary' }] },
    });

    const busy = res.data.calendars.primary.busy || [];
    if (busy.length > 0) return { disponible: false, motivo: 'Ocupado en Google Calendar' };
  }

  return { disponible: true };
}

// Ruta A: otras horas del mismo barbero, mismo día
async function otrasHorasMismoDia(barbero, fecha, duracionMin) {
  return obtenerHorariosLibres(barbero, fecha, duracionMin);
}

// Ruta B: mismo barbero, misma hora deseada, buscando en los próximos N días
async function otroDiaMismaHora(barbero, horaDeseada, duracionMin, diasAdelante = 7) {
  const hoy = new Date();
  for (let i = 1; i <= diasAdelante; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(fecha.getDate() + i);
    const fechaStr = fecha.toISOString().split('T')[0];
    const libres = await obtenerHorariosLibres(barbero, fechaStr, duracionMin);
    if (libres.includes(horaDeseada)) {
      return { fecha: fechaStr, hora: horaDeseada };
    }
  }
  return null;
}

// Ruta C: mismo día, misma hora deseada, con otro barbero disponible
async function otroBarberoMismaFechaHora(barberosTodos, barberoExcluidoId, fecha, horaDeseada, duracionMin) {
  for (const otro of barberosTodos.filter(b => b.id !== barberoExcluidoId)) {
    const libres = await obtenerHorariosLibres(otro, fecha, duracionMin);
    if (libres.includes(horaDeseada)) {
      return { barbero: otro };
    }
  }
  return null;
}

module.exports = {
  obtenerHorariosLibres, estaDisponible,
  otrasHorasMismoDia, otroDiaMismaHora, otroBarberoMismaFechaHora,
};