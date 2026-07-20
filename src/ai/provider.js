// Selecciona el proveedor de IA según la variable de entorno AI_PROVIDER (default: gemini)
require('dotenv').config();

const proveedor = process.env.AI_PROVIDER || 'gemini';

const implementaciones = {
  gemini: './providers/gemini',
  groq: './providers/groq',
  local: './providers/local',
};

const rutaModulo = implementaciones[proveedor];

if (!rutaModulo) {
  throw new Error(`AI_PROVIDER "${proveedor}" no reconocido. Usa: ${Object.keys(implementaciones).join(', ')}`);
}

module.exports = require(rutaModulo);