// Servidor Express para OAuth callback y auth inicial por barbero
const express = require('express');
const { generarUrlAuth, guardarTokens } = require('./calendar/oauth');
const { obtenerQrActual } = require('./core/session');

const QRCode = require('qrcode');
const app = express();

// Muestra el QR actual como imagen PNG para escanear desde el navegador
app.get('/qr', async (req, res) => {
  const qr = obtenerQrActual();

  if (!qr) {
    return res.send('No hay QR disponible en este momento (ya conectado o aún generando).');
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