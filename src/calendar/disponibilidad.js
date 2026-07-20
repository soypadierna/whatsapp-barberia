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

// Sugiere alternativas en cascada: (a) mismo barbero mismo día, (b) otros barberos mismo día/hora, (c) mismo barbero otro día cercano
async function sugerirAlternativasAmplias({ barbero, barberosTodos, fecha, hora, duracionMin }) {
  // (a) Mismo barbero, mismo día, otras horas
  const libresMismoDia = await obtenerHorariosLibres(barbero, fecha, duracionMin);
  if (libresMismoDia.length > 0) {
    return { tipo: 'mismo_barbero_mismo_dia', barbero: barbero.nombre, fecha, opciones: libresMismoDia.slice(0, 3) };
  }

  // (b) Otros barberos, mismo día, cerca de la hora pedida
  for (const otro of barberosTodos.filter(b => b.id !== barbero.id)) {
    const libresOtro = await obtenerHorariosLibres(otro, fecha, duracionMin);
    if (libresOtro.length > 0) {
      return { tipo: 'otro_barbero_mismo_dia', barbero: otro.nombre, fecha, opciones: libresOtro.slice(0, 3) };
    }
  }

  // (c) Mismo barbero, próximos días (hasta 5 días adelante)
  const fechaBase = new Date(fecha + 'T00:00:00');
  for (let i = 1; i <= 5; i++) {
    const siguiente = new Date(fechaBase);
    siguiente.setDate(siguiente.getDate() + i);
    const fechaStr = siguiente.toISOString().split('T')[0];
    const libres = await obtenerHorariosLibres(barbero, fechaStr, duracionMin);
    if (libres.length > 0) {
      return { tipo: 'mismo_barbero_otro_dia', barbero: barbero.nombre, fecha: fechaStr, opciones: libres.slice(0, 3) };
    }
  }

  return { tipo: 'sin_opciones' };
}

module.exports = { obtenerHorariosLibres, sugerirAlternativasAmplias };