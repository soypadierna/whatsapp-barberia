// Servidor Express para OAuth callback y auth inicial por barbero
const express = require('express');
const { generarUrlAuth, guardarTokens } = require('./calendar/oauth');
const { obtenerQrActual, estaConectado, emisorQr } = require('./core/session');
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

// Página definitiva: QR en ASCII (método confirmado que funciona), con diseño limpio tipo WhatsApp Web
app.get('/qr', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Vincular WhatsApp</title>
<style>
  body {
    background: #f0f2f5;
    font-family: -apple-system, Segoe UI, Roboto, sans-serif;
    display: flex; justify-content: center; align-items: center;
    height: 100vh; margin: 0;
  }
  .card {
    background: white; border-radius: 12px; padding: 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;
  }
  h2 { color: #075E54; margin-bottom: 4px; }
  p { color: #667781; font-size: 14px; margin-top: 12px; }
pre {
    background: #fff; color: #111;
    font-family: 'Consolas', 'Menlo', monospace;
    font-size: 8px; line-height: 8px;
    white-space: pre;
    padding: 12px; border-radius: 8px;
    border: 1px solid #e0e0e0;
    display: inline-block; text-align: left; margin: 0;
  }
  .ok { color: #128C7E; font-size: 18px; font-weight: bold; }
</style>
</head>
<body>
  <div class="card">
    <h2>WhatsApp Barbería</h2>
    <div id="contenido"><p>Esperando código QR...</p></div>
  </div>

  <script>
    const contenido = document.getElementById('contenido');
    const evtSource = new EventSource('/qr-stream');

    evtSource.addEventListener('qr', (e) => {
      const ascii = JSON.parse(e.data);
      contenido.innerHTML = '<pre>' + ascii + '</pre><p>Escanea con WhatsApp > Dispositivos vinculados</p>';
    });

    evtSource.addEventListener('conectado', () => {
      contenido.innerHTML = '<p class="ok">✅ Conectado correctamente</p>';
      evtSource.close();
    });
  </script>
</body>
</html>
  `);
});

// SSE que empuja el QR como ASCII escaneable (único método de generación de QR en el proyecto)
app.get('/qr-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enviarQr = (qr) => {
    const ascii = generarAsciiLimpio(qr);
    // Reemplaza saltos de línea reales por \n literal para viajar en una sola línea SSE, se reconstruyen en el navegador
    res.write(`event: qr\ndata: ${JSON.stringify(ascii)}\n\n`);
  };

  const enviarConectado = () => {
    res.write(`event: conectado\ndata: ok\n\n`);
  };

  if (estaConectado()) {
    enviarConectado();
  } else if (obtenerQrActual()) {
    enviarQr(obtenerQrActual());
  }

  emisorQr.on('qr', enviarQr);
  emisorQr.on('conectado', enviarConectado);

  req.on('close', () => {
    emisorQr.off('qr', enviarQr);
    emisorQr.off('conectado', enviarConectado);
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