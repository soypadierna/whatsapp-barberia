// Conexión y sesión de WhatsApp con Baileys (persistencia en Supabase)
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { EventEmitter } = require('events');
const { useSupabaseAuthState } = require('../db/authState');

let sock;
let qrActual = null;
let conectado = false;
const emisorQr = new EventEmitter(); // emite 'qr' y 'conectado' para SSE

async function iniciarSesion(onMensaje) {
  const { state, saveCreds } = await useSupabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrActual = qr;
      conectado = false;
      emisorQr.emit('qr', qr);
    }

    if (connection === 'close') {
      const debeReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectar:', debeReconectar);
      if (debeReconectar) iniciarSesion(onMensaje);
    } else if (connection === 'open') {
      qrActual = null;
      conectado = true;
      console.log('✅ Conectado a WhatsApp');
      emisorQr.emit('conectado');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const numero = msg.key.remoteJid;
    if (onMensaje) await onMensaje({ texto, numero, sock });
  });

  return sock;
}

function obtenerQrActual() { return qrActual; }
function estaConectado() { return conectado; }

module.exports = { iniciarSesion, obtenerQrActual, estaConectado, emisorQr };