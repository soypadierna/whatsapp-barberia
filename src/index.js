const { iniciarSesion } = require('./core/session');

iniciarSesion(async ({ texto, numero, sock }) => {
  console.log(`Mensaje de ${numero}: ${texto}`);
  await sock.sendMessage(numero, { text: 'Hola, recibí tu mensaje ✅' });
});