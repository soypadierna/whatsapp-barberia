// Detección de intent usando Gemini (function calling)
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const tools = [
  {
    functionDeclarations: [
      {
        name: 'agendar',
        description: 'El cliente quiere agendar, reservar o pedir una cita/turno',
      },
      {
        name: 'cancelar',
        description: 'El cliente quiere cancelar o anular una cita existente',
      },
      {
        name: 'horarios',
        description: 'El cliente pregunta por horarios o disponibilidad de atención',
      },
      {
        name: 'precios',
        description: 'El cliente pregunta por precios o costos de servicios',
      },
    ],
  },
];

async function detectarIntent(texto) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', tools });

  const result = await model.generateContent(texto);
  const call = result.response.functionCalls()?.[0];

  return call ? call.name : null;
}

module.exports = { detectarIntent };