// Autenticación OAuth de Google Calendar (una vez por barbero)
const { google } = require('googleapis');
const { supabase } = require('../db/client');
const logger = require('../utils/logger');

require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Genera URL para que el barbero autorice acceso
function generarUrlAuth(barberoId) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: barberoId,
  });
}

// Guarda tokens en Supabase tras autorizar (usar en endpoint de callback)
async function guardarTokens(barberoId, code) {
  const { tokens } = await oauth2Client.getToken(code);

  const { error } = await supabase.from('calendar_tokens').upsert({
    barbero_id: barberoId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });

  if (error) {
    logger.error(`Fallo guardando tokens de Calendar para barbero ${barberoId}`, error.message);
    throw new Error(`No se pudo guardar el token: ${error.message}`);
  }

  logger.calendar(`Tokens de Calendar guardados OK para barbero ${barberoId}`);
  return tokens;
}

// Obtiene un cliente OAuth ya autenticado para un barbero
async function obtenerClienteBarbero(barberoId) {
  const { data } = await supabase
    .from('calendar_tokens').select('*').eq('barbero_id', barberoId).single();

  if (!data) return null;

  const cliente = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  cliente.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date,
  });

  return cliente;
}

module.exports = { generarUrlAuth, guardarTokens, obtenerClienteBarbero, oauth2Client };