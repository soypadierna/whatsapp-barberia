// Rutas de administración: dashboard de citas, catálogo y métricas, protegidas por token secreto en la URL
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/client');
const logger = require('../utils/logger');

// Middleware: valida el token en la ruta, responde 404 si no coincide (no revela que la ruta existe)
function validarToken(req, res, next) {
  const tokenEsperado = process.env.ADMIN_DASHBOARD_TOKEN;
  const tokenRecibido = req.params.token;

  if (!tokenEsperado || tokenRecibido !== tokenEsperado) {
    return res.status(404).send('Not found');
  }
  next();
}

// Página principal del dashboard (HTML estático, la lógica vive en el JS del archivo)
router.get('/admin/:token', validarToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(require('path').join(__dirname, '..', 'views', 'admin.html'));
});

// --- API: Citas ---

router.get('/admin/:token/api/citas', validarToken, async (req, res) => {
  const { desde, hasta, barbero_id } = req.query;

  let query = supabase
    .from('citas')
    .select('id, fecha, hora, estado, cliente_telefono, barberos(id, nombre), servicios(nombre, precio)')
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true });

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  if (barbero_id) query = query.eq('barbero_id', barbero_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/admin/:token/api/citas/:id/cancelar', validarToken, async (req, res) => {
  const { id } = req.params;

  const { data: cita } = await supabase.from('citas').select('barbero_id').eq('id', id).single();
  const { error } = await supabase.from('citas').update({ estado: 'cancelada' }).eq('id', id);

  if (error) return res.status(500).json({ error: error.message });

  // Reutiliza la misma lógica de sync que usa WhatsApp, no se duplica
  const { eliminarEvento } = require('../calendar/sync');
  if (cita) await eliminarEvento({ citaId: id, barberoId: cita.barbero_id });

  res.json({ ok: true });
});

// --- API: Servicios ---

router.get('/admin/:token/api/servicios', validarToken, async (req, res) => {
  const { data, error } = await supabase.from('servicios').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/admin/:token/api/servicios/:id', validarToken, express.json(), async (req, res) => {
  const { nombre, precio, duracion_min } = req.body;
  const { error } = await supabase.from('servicios').update({ nombre, precio, duracion_min }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post('/admin/:token/api/servicios', validarToken, express.json(), async (req, res) => {
  const { nombre, precio, duracion_min } = req.body;
  const { error } = await supabase.from('servicios').insert({ nombre, precio, duracion_min });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- API: Barberos ---

router.get('/admin/:token/api/barberos', validarToken, async (req, res) => {
  const { data, error } = await supabase.from('barberos').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/admin/:token/api/barberos/:id', validarToken, express.json(), async (req, res) => {
  const { nombre, horario_inicio, horario_fin, activo } = req.body;
  const { error } = await supabase.from('barberos').update({ nombre, horario_inicio, horario_fin, activo }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- API: Métricas ---

router.get('/admin/:token/api/metricas', validarToken, async (req, res) => {
  const { desde, hasta } = req.query;

  let query = supabase
    .from('citas')
    .select('id, estado, barbero_id, barberos(nombre), servicios(precio)')
    .neq('estado', 'cancelada');

  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const totalCitas = data.length;
  const ingresosEstimados = data.reduce((sum, c) => sum + (c.servicios?.precio || 0), 0);

  const porBarbero = {};
  data.forEach(c => {
    const nombre = c.barberos?.nombre || 'Sin barbero';
    porBarbero[nombre] = (porBarbero[nombre] || 0) + 1;
  });

  res.json({ totalCitas, ingresosEstimados, porBarbero });
});

module.exports = router;