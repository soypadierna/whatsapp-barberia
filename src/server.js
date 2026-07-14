// Servidor Express para OAuth callback y auth inicial por barbero
const express = require('express');
const { generarUrlAuth, guardarTokens } = require('./calendar/oauth');
const { obtenerQrActual } = require('./core/session');
const { solicitarPairingCode } = require('./core/session');

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

// Página que muestra el QR y se auto-refresca cada 20s
app.get('/qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.send(`
    <html>
      <head><meta http-equiv="refresh" content="5"></head>
      <body style="text-align:center; font-family: sans-serif;">
        <h3>Escanea el código QR</h3>
        <img src="/qr-image?t=${Date.now()}" style="width:300px;height:300px;" />
        <p>Escanea apenas cargue la página. Se actualiza cada 5 segundos.</p>
      </body>
    </html>
  `);
});

// Endpoint que sirve la imagen PNG cruda del QR
app.get('/qr-image', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const qr = obtenerQrActual();

  if (!qr) {
    return res.send('Sin QR disponible (ya conectado o generando).');
  }

  try {
    const png = await QRCode.toBuffer(qr, { type: 'png', width: 300 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).send('Error al generar el QR');
  }
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

app.listen(3000, () => console.log('Servidor OAuth en http://localhost:3000'));

module.exports = app;