// Conexión y sesión de WhatsApp con Baileys (persistencia en Supabase)
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { useSupabaseAuthState } = require('../db/authState');

let sock;
let qrActual = null;

async function iniciarSesion(onMensaje) {
  const { state, saveCreds } = await useSupabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
  });

  // Si no está registrado y hay un número configurado, pide el pairing code apenas conecta
  const numeroPairing = process.env.PAIRING_NUMBER;
  if (!sock.authState.creds.registered && numeroPairing) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(numeroPairing);
        console.log('📱 CÓDIGO DE EMPAREJAMIENTO:', codigo);
      } catch (err) {
        console.log('Error solicitando pairing code:', err.message);
      }
    }, 3000); // Baileys recomienda esperar unos segundos tras crear el socket
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log('DEBUG connection.update:', JSON.stringify({ connection, qr: !!qr, error: lastDisconnect?.error?.message, statusCode: lastDisconnect?.error?.output?.statusCode }));

    if (qr) qrActual = qr;

    if (connection === 'close') {
      const debeReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectar:', debeReconectar);
      if (debeReconectar) iniciarSesion(onMensaje);
    } else if (connection === 'open') {
      qrActual = null;
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