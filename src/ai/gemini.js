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

// Redacta respuestas con tono de "vendedor amigable" que siempre empuja hacia agendar
async function generarRespuestaNatural(contexto) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const promptSistema = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es cálida, cercana y ligeramente entusiasta, como un buen vendedor que genuinamente quiere ayudar (nunca agresivo ni insistente).

Reglas de tono:
- Español natural, frases cortas, máximo 1 emoji por mensaje (moderado, no saturar).
- Nunca sonar como menú o formulario. Nunca listar opciones con guiones o números salvo que el contexto lo pida explícitamente (ej. mostrar servicios).
- Cada respuesta debe cerrar empujando amablemente hacia el siguiente paso natural de la conversación (idealmente hacia agendar una cita), sin sonar forzado.
- Si el contexto es un saludo inicial, da la bienvenida y ofrece agendar/precios/horarios en una sola frase fluida.
- Si el contexto es mostrar disponibilidad, sugiere las opciones de forma natural y pregunta cuál prefiere.
- Si el contexto es una confirmación, celebra brevemente y confirma los datos clave.

Contexto de la situación actual: ${JSON.stringify(contexto)}

Responde SOLO con el mensaje final para el cliente, sin explicaciones ni comillas.`;

  const result = await model.generateContent(promptSistema);
  return result.response.text().trim();
}

module.exports = { detectarIntent, generarRespuestaNatural };