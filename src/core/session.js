// Conexión y sesión de WhatsApp con Baileys (persistencia en Supabase)
const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { useSupabaseAuthState } = require('../db/authState');

let sock;
let qrActual = null; // guarda el QR más reciente para exponerlo por HTTP

async function iniciarSesion(onMensaje) {
  const { state, saveCreds } = await useSupabaseAuthState();

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrActual = qr;
      console.log('Nuevo QR generado, visita /qr para escanearlo');
    }

    if (connection === 'close') {
      const debeReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectar:', debeReconectar);
      if (debeReconectar) iniciarSesion(onMensaje);
    } else if (connection === 'open') {
      qrActual = null; // ya no hace falta el QR
      console.log('✅ Conectado a WhatsApp');
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

function obtenerQrActual() {
  return qrActual;
}

module.exports = { iniciarSesion, obtenerQrActual };