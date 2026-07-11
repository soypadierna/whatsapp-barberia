const { iniciarSesion } = require('./core/session');
const { enrutarMensaje } = require('./core/router');
require('./server'); // levanta el endpoint OAuth junto al bot

console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY existe:', !!process.env.SUPABASE_KEY);

iniciarSesion(enrutarMensaje);