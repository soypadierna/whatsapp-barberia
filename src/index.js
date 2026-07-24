const { iniciarSesion } = require('./core/session');
const { enrutarMensaje } = require('./core/router');
const { cargarEstadoInicial } = require('./db/estadoBot');
require('./server');

(async () => {
  await cargarEstadoInicial();
  iniciarSesion(enrutarMensaje);
})();