// Conexión y sesión de WhatsApp con Baileys (persistencia en Supabase)
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { EventEmitter } = require('events');
const { useSupabaseAuthState, limpiarSesionCompleta } = require('../db/authState');

let sock;
let qrActual = null;
let conectado = false;
const emisorQr = new EventEmitter();

async function iniciarSesion(onMensaje) {
  const { state, saveCreds } = await useSupabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrActual = qr;
      conectado = false;
      emisorQr.emit('qr', qr);
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const esLogout = codigo === DisconnectReason.loggedOut;

      if (esLogout) {
        // Sesión inválida real: limpiar Supabase y reiniciar desde cero para forzar QR nuevo
        console.log('⚠️ Sesión inválida (logout). Limpiando y regenerando QR automáticamente...');
        await limpiarSesionCompleta();
        setTimeout(() => iniciarSesion(onMensaje), 1000);
      } else {
        // Error de red u otro tipo: reconectar con la misma sesión
        console.log('Conexión cerrada por error de red. Reconectando con sesión existente...');
        iniciarSesion(onMensaje);
      }
      return;
    }

    if (connection === 'open') {
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