const { iniciarSesion } = require('./core/session');
const { enrutarMensaje } = require('./core/router');
require('./server'); // levanta el endpoint OAuth junto al bot

iniciarSesion(enrutarMensaje);