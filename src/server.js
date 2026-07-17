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

// Página con diseño tipo WhatsApp Web, se actualiza en tiempo real vía SSE (sin recargar)
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
    background: white; border-radius: 12px; padding: 40px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; width: 340px;
  }
  h2 { color: #075E54; margin-bottom: 8px; }
  p { color: #667781; font-size: 14px; }
  #qr-img { width: 260px; height: 260px; margin: 20px 0; border: 1px solid #eee; border-radius: 8px; }
  .ok { color: #128C7E; font-size: 18px; font-weight: bold; }
</style>
</head>
<body>
  <div class="card">
    <h2>WhatsApp Barbería</h2>
    <div id="contenido">
      <p>Esperando código QR...</p>
    </div>
  </div>

<script>
    const contenido = document.getElementById('contenido');
    const evtSource = new EventSource('/qr-stream');
    let countdownInterval;

    function iniciarCountdown(segundos) {
      clearInterval(countdownInterval);
      let restante = segundos;
      const badge = document.getElementById('countdown');
      countdownInterval = setInterval(() => {
        restante--;
        if (badge) badge.textContent = restante > 0 ? `Expira en ${ restante }s` : 'Generando nuevo código...';
        if (restante <= 0) clearInterval(countdownInterval);
      }, 1000);
    }

    evtSource.addEventListener('qr', (e) => {
      contenido.innerHTML = '<img id="qr-img" src="' + e.data + '" /><p>Escanea con WhatsApp > Dispositivos vinculados</p><p id="countdown" style="color:#128C7E;font-weight:bold;"></p>';
      iniciarCountdown(20);
    });

    evtSource.addEventListener('conectado', () => {
      clearInterval(countdownInterval);
      contenido.innerHTML = '<p class="ok">✅ Conectado correctamente</p>';
      evtSource.close();
    });
  </script>
</body>
</html>
  `);
});

// Server-Sent Events: empuja el QR (como data URL base64) o el estado "conectado" en tiempo real
app.get('/qr-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const enviarQr = async (qr) => {
    const dataUrl = await QRCode.toDataURL(qr, { width: 260 });
    res.write(`event: qr\ndata: ${dataUrl}\n\n`);
  };

  const enviarConectado = () => {
    res.write(`event: conectado\ndata: ok\n\n`);
  };

  // Estado inicial al conectar el cliente
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

app.listen(3000, () => console.log('Servidor OAuth en http://localhost:3000'));

module.exports = app;