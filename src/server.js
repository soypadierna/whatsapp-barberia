// Servidor Express para OAuth callback y auth inicial por barbero
const express = require('express');
const { generarUrlAuth, guardarTokens } = require('./calendar/oauth');
const { obtenerQrActual, estaConectado, emisorQr, solicitarPairingCode } = require('./core/session');

const path = require('path');
const QRCode = require('qrcode');
const app = express();

// Solicita un código de emparejamiento de 8 dígitos para un número específico
app.get('/pair', async (req, res) => {
  const { numero } = req.query; // formato: 573001112233 (sin +, sin espacios)

  if (!numero) {
    return res.send('Usa /pair?numero=573001112233 (código de país + número, sin +)');
  }

  try {
    const codigo = await solicitarPairingCode(numero);
    res.send(`Tu código de emparejamiento es: <b>${codigo}</b><br>Ingrésalo en WhatsApp > Dispositivos vinculados > Vincular con número de teléfono`);
  } catch (err) {
    res.status(500).send('Error al generar código: ' + err.message);
  }
});

// Sirve la vista de /qr desde archivo estático, separando presentación de lógica
app.get('/qr', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'views', 'qr.html'));
});

app.get('/qr-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enviarQr = (qr) => {
    const ascii = generarAsciiLimpio(qr);
    res.write(`event: qr\ndata: ${JSON.stringify(ascii)}\n\n`);
  };

  const enviarConectado = () => {
    res.write(`event: conectado\ndata: ok\n\n`);
  };

  const enviarAlerta = (info) => {
    res.write(`event: alerta\ndata: ${JSON.stringify(info)}\n\n`);
  };

  if (estaConectado()) {
    enviarConectado();
  } else if (obtenerQrActual()) {
    enviarQr(obtenerQrActual());
  }

  emisorQr.on('qr', enviarQr);
  emisorQr.on('conectado', enviarConectado);
  emisorQr.on('alerta_numero_distinto', enviarAlerta);

  req.on('close', () => {
    emisorQr.off('qr', enviarQr);
    emisorQr.off('conectado', enviarConectado);
    emisorQr.off('alerta_numero_distinto', enviarAlerta);
  });
});

// Genera el link de autorización para un barbero (uso manual una vez)
app.get('/oauth/authorize', (req, res) => {
  const { barbero_id } = req.query;

  if (!barbero_id) {
    return res.status(400).send('Falta barbero_id. Usa /oauth/authorize?barbero_id=1');
  }

  const url = generarUrlAuth(barbero_id);
  res.redirect(url);
});

// Recibe el code de Google y guarda tokens
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  const barberoId = req.query.state; // pasar barbero_id como state en generarUrlAuth

  if (!code || !barberoId) {
    return res.status(400).send('Falta code o barbero_id');
  }

  try {
    await guardarTokens(barberoId, code);
    res.send('Listo, ya puedes cerrar esta ventana ✅');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al guardar tokens');
  }
});

// Genera el QR como texto ASCII puro (bloques Unicode), sin códigos ANSI de color
function generarAsciiLimpio(qrData) {
  const matriz = QRCode.create(qrData, { errorCorrectionLevel: 'M' }).modules;
  const size = matriz.size;
  const data = matriz.data;
  let resultado = '';

  // Recorre de a 2 filas por línea usando caracteres de medio bloque (▀▄█ ) para compactar el ASCII
  for (let y = 0; y < size; y += 2) {
    let linea = '';
    for (let x = 0; x < size; x++) {
      const arriba = data[y * size + x];
      const abajo = (y + 1 < size) ? data[(y + 1) * size + x] : 0;

      if (arriba && abajo) linea += '█';
      else if (arriba && !abajo) linea += '▀';
      else if (!arriba && abajo) linea += '▄';
      else linea += ' ';
    }
    resultado += linea + '\n';
  }

  return resultado;
}

app.listen(3000, () => console.log('Servidor OAuth en http://localhost:3000'));

module.exports = app;