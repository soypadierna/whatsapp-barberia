// Estado global de pausa del bot, persistido en Supabase (sobrevive a reinicios)
const { supabase } = require('./client');
const logger = require('../utils/logger');

let cachePausado = false; // cache en memoria para no consultar Supabase en cada mensaje

async function cargarEstadoInicial() {
  const { data, error } = await supabase.from('estado_bot').select('pausado').eq('id', 'global').maybeSingle();
  if (error) {
    logger.error('Fallo cargando estado_bot, se asume activo por defecto', error.message);
    return;
  }
  cachePausado = data?.pausado || false;
  logger.sesion(`Estado inicial del bot: ${cachePausado ? 'PAUSADO' : 'ACTIVO'}`);
}

function estaPausado() {
  return cachePausado;
}

async function pausarBot() {
  cachePausado = true;
  const { error } = await supabase.from('estado_bot').upsert({ id: 'global', pausado: true, updated_at: new Date().toISOString() });
  if (error) logger.error('Fallo guardando pausa del bot', error.message);
}

async function reanudarBot() {
  cachePausado = false;
  const { error } = await supabase.from('estado_bot').upsert({ id: 'global', pausado: false, updated_at: new Date().toISOString() });
  if (error) logger.error('Fallo guardando reanudación del bot', error.message);
}

module.exports = { cargarEstadoInicial, estaPausado, pausarBot, reanudarBot };
