const { iniciarSesion } = require('./core/session');
const { enrutarMensaje } = require('./core/router');

iniciarSesion(enrutarMensaje);