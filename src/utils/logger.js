// Logger simple con timestamp y categoría, para diagnosticar sin depender de capturar el error en vivo
function timestamp() {
  return new Date().toISOString();
}

function log(categoria, mensaje, extra = null) {
  const linea = `[${timestamp()}] [${categoria}] ${mensaje}`;
  if (extra) {
    console.log(linea, extra);
  } else {
    console.log(linea);
  }
}

// Enmascara un número de WhatsApp para no exponerlo completo en logs (ej. 573001112233 -> 5730****233)
function enmascararNumero(numero) {
  if (!numero) return 'desconocido';
  const limpio = numero.replace('@s.whatsapp.net', '');
  if (limpio.length < 6) return '***';
  return `${limpio.slice(0, 4)}****${limpio.slice(-3)}`;
}

module.exports = {
  conexion: (msg, extra) => log('CONEXION', msg, extra),
  sesion: (msg, extra) => log('SESION', msg, extra),
  mensaje: (msg, extra) => log('MENSAJE', msg, extra),
  calendar: (msg, extra) => log('CALENDAR', msg, extra),
  error: (msg, extra) => log('ERROR', msg, extra),
  enmascararNumero,
};