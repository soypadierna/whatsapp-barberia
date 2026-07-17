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
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview', tools });

  const result = await model.generateContent(texto);
  const call = result.response.functionCalls()?.[0];

  return call ? call.name : null;
}

// Redacta respuestas con tono de "vendedor amigable" que siempre empuja hacia agendar
async function generarRespuestaNatural(contexto) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const promptSistema = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es amigable, profesional y cercana, pero NUNCA íntima.

Reglas de tono (ESTRICTAS, sin excepción):
- NUNCA adoptes apodos cariñosos, coqueteos, ni lenguaje íntimo o informal que el cliente use. Mantén siempre distancia profesional y cercanía cordial, sin importar cómo escriba el cliente.
- Responde de forma concreta y corta, lo justo para que se entienda y se perciba buen servicio.
- Español natural, frases cortas, máximo 1 emoji por mensaje.
- NUNCA presentes los servicios u opciones como lista numerada rígida (1. 2. 3.) salvo que el cliente pida explícitamente ver "todo" o el catálogo completo. En vez de eso, menciónalos de forma fluida dentro de la frase, ej: "tenemos corte clásico a $5000, corte con barba a $8000, o solo barba a $3000, ¿cuál te late?"
- Si faltan datos para agendar (contexto tipo "pedir_datos_faltantes"), pregunta SOLO por lo que falta, de forma natural y en una sola frase fluida, sin repetir lo que el cliente ya dijo. Si falta el servicio, menciona las opciones conversacionalmente. Si falta el barbero, pregunta con quién prefiere o si no tiene preferencia. Nunca suenes a formulario completando campos.
- Si el cliente da varios datos en un mismo mensaje, no le vuelvas a preguntar por esos datos.
- Si no entiendes bien algo, no digas "no reconocí eso" — pregunta de forma natural intentando confirmar tu mejor interpretación, ej: "¿te refieres a corte con barba?"
- Cada respuesta debe sentirse como parte de UNA sola conversación fluida, nunca como un paso de formulario aislado.

Contexto de la situación actual: ${JSON.stringify(contexto)}

Responde SOLO con el mensaje final para el cliente, sin explicaciones ni comillas.`;

  const result = await model.generateContent(promptSistema);
  return result.response.text().trim();
}

// Extrae datos de agendamiento en lenguaje libre (servicio, barbero, fecha, hora) usando function calling
async function extraerDatosCita(texto, contextoActual, catalogos) {
  const toolsExtraccion = [
    {
      functionDeclarations: [
        {
          name: 'actualizar_datos_cita',
          description: 'Extrae o actualiza los datos de una cita a partir del mensaje del cliente',
          parameters: {
            type: 'object',
            properties: {
              servicio: { type: 'string', description: 'Nombre del servicio que quiere el cliente, tal como aparece en el catálogo, o null si no lo menciona' },
              barbero: { type: 'string', description: 'Nombre del barbero que quiere el cliente, o null si no lo menciona o dice que no tiene preferencia' },
              fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD si el cliente la menciona (interpreta "hoy", "mañana", días de la semana), o null' },
              hora: { type: 'string', description: 'Hora en formato HH:MM si el cliente la menciona, o null' },
            },
          },
        },
      ],
    },
  ];

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview', tools: toolsExtraccion });

  const hoy = new Date().toISOString().split('T')[0];
  const prompt = `Fecha de hoy: ${hoy}.
Catálogo de servicios disponibles: ${catalogos.servicios.map(s => s.nombre).join(', ')}.
Barberos disponibles: ${catalogos.barberos.map(b => b.nombre).join(', ')}.
Datos ya conocidos de esta conversación: ${JSON.stringify(contextoActual)}.
Mensaje nuevo del cliente: "${texto}"

Extrae los datos que el cliente menciona en este mensaje (puede mencionar uno, varios, o ninguno). Si menciona un servicio o barbero con errores de tipeo, corrígelo al nombre exacto del catálogo. Llama a la función con lo que puedas inferir.`;

  const result = await model.generateContent(prompt);
  const call = result.response.functionCalls()?.[0];

  return call ? call.args : {};
}

module.exports = { detectarIntent, generarRespuestaNatural, extraerDatosCita };