// Conexión y sesión de WhatsApp con Baileys (persistencia en Supabase)
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { EventEmitter } = require('events');
const { useSupabaseAuthState, limpiarSesionCompleta, guardarNumeroVinculado, leerNumeroVinculado } = require('../db/authState');
const logger = require('../utils/logger');

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
    qrTimeout: 20000, // fuerza regeneración de QR cada 20s (estándar de WhatsApp), evita códigos vencidos
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();

    const numeroActual = sock.authState?.creds?.me?.id;
    if (!numeroActual) return;

    const numeroGuardado = await leerNumeroVinculado();

    if (numeroGuardado && numeroGuardado !== numeroActual) {
      // Comparación exacta de string, sin normalización, para evitar falsos positivos/negativos
      logger.sesion(`⚠️ Número distinto al guardado — anterior: ${numeroGuardado}, nuevo: ${numeroActual}`);
      emisorQr.emit('alerta_numero_distinto', { anterior: numeroGuardado, nuevo: numeroActual });
    }

    await guardarNumeroVinculado(numeroActual);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrActual = qr;
      conectado = false;
      logger.conexion('QR generado, esperando escaneo');
      emisorQr.emit('qr', qr);
    }

    if (connection === 'connecting') {
      logger.conexion('Conectando a WhatsApp...');
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const motivo = lastDisconnect?.error?.message || 'desconocido';
      const esLogout = codigo === DisconnectReason.loggedOut;

      logger.conexion(`Desconectado. Código: ${codigo}, Motivo: ${motivo}, Logout: ${esLogout}`);

      if (esLogout) {
        logger.sesion('Sesión inválida detectada, limpiando Supabase automáticamente');
        await limpiarSesionCompleta();
        logger.conexion('Reiniciando conexión para generar QR nuevo');
        setTimeout(() => iniciarSesion(onMensaje), 1000);
      } else {
        logger.conexion('Reconectando con sesión existente...');
        iniciarSesion(onMensaje);
      }
      return;
    }

    if (connection === 'open') {
      qrActual = null;
      conectado = true;
      logger.conexion('✅ Conectado a WhatsApp');
      emisorQr.emit('conectado');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages[0];
      const numero = msg.key.remoteJid;

      // Filtra mensajes que no son de un cliente real: status/broadcast, grupos, o sin contenido
      if (!msg.message || msg.key.fromMe) return;
      if (numero === 'status@broadcast') return;
      if (numero?.endsWith('@g.us')) return; // grupos, no soportados por ahora

      const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!texto.trim()) return; // contenido vacío (stickers, reacciones, etc.)

      logger.mensaje(`Recibido de ${logger.enmascararNumero(numero)}: "${texto.slice(0, 50)}"`);

      if (onMensaje) await onMensaje({ texto, numero, sock });
    } catch (err) {
      logger.error('Error no capturado procesando mensaje', err.stack);
    }
  });

  return sock;
}

function obtenerQrActual() { return qrActual; }
function estaConectado() { return conectado; }

module.exports = { iniciarSesion, obtenerQrActual, estaConectado, emisorQr };