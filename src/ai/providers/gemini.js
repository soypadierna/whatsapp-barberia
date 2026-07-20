// Implementación del proveedor Gemini (mismo contrato que src/ai/provider.js espera)
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const logger = require('../../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function llamarConRetry(fn) {
  const backoffs = [2000, 5000, 10000];

  for (let intento = 0; intento <= backoffs.length; intento++) {
    try {
      return await fn();
    } catch (err) {
      const es429 = err.status === 429 || err.message?.includes('429');
      const es503 = err.status === 503 || err.message?.includes('503') || err.message?.includes('Service Unavailable');

      if (!es429 && !es503) throw err;
      if (intento === backoffs.length) throw err;

      let esperaMs = backoffs[intento];
      if (es429) {
        const delayInfo = err.errorDetails?.find(d => d['@type']?.includes('RetryInfo'));
        if (delayInfo?.retryDelay) esperaMs = parseInt(delayInfo.retryDelay) * 1000;
      }

      logger.error(`Error temporal de Gemini (${es429 ? '429' : '503'}), reintento ${intento + 1}/${backoffs.length} en ${esperaMs / 1000}s`);
      await new Promise(r => setTimeout(r, esperaMs));
    }
  }
}

async function procesarMensajeInicial(texto) {
  const toolsCombinado = [
    {
      functionDeclarations: [
        {
          name: 'responder_cliente',
          description: 'Determina el intent del cliente y redacta la respuesta a enviarle',
          parameters: {
            type: 'object',
            properties: {
              intent: {
                type: 'string',
                enum: ['agendar', 'cancelar', 'horarios', 'precios', 'ninguno'],
                description: 'La intención principal del cliente, o "ninguno" si es un saludo o no está claro',
              },
              respuesta: {
                type: 'string',
                description: 'La respuesta a enviar al cliente. Si el intent es agendar/cancelar/horarios/precios, deja este campo vacío. Si el intent es "ninguno", redacta aquí la respuesta natural.',
              },
            },
            required: ['intent'],
          },
        },
      ],
    },
  ];

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview', tools: toolsCombinado });
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const prompt = `Eres el asistente de WhatsApp de "${nombreBarberia}". Personalidad amigable, profesional, cercana pero NUNCA íntima (nunca adoptes apodos cariñosos o tono coqueto del cliente, sin excepción). Respuestas cortas y concretas, máximo 1 emoji.

Mensaje del cliente: "${texto}"

Determina la intención y, si es "ninguno", redacta también la respuesta a enviarle: cálida, breve, y que ofrezca agendar/precios/horarios de forma fluida (nunca como lista/menú). Si la intención SÍ es agendar/cancelar/horarios/precios, deja "respuesta" vacío.`;

  const result = await llamarConRetry(() => model.generateContent(prompt));
  const call = result.response.functionCalls()?.[0];

  if (!call) return { intent: null, respuesta: null };
  return { intent: call.args.intent === 'ninguno' ? null : call.args.intent, respuesta: call.args.respuesta || null };
}

async function generarRespuestaNatural(contexto) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const promptSistema = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es amigable, profesional y cercana, pero NUNCA íntima.

Reglas de tono (ESTRICTAS, sin excepción):
- NUNCA adoptes apodos cariñosos, coqueteos, ni lenguaje íntimo o informal que el cliente use. Mantén siempre distancia profesional y cercanía cordial.
- Responde de forma concreta y corta.
- Español natural, frases cortas, máximo 1 emoji por mensaje.
- NUNCA presentes servicios como lista numerada rígida salvo que el cliente pida explícitamente el catálogo completo.
- Si faltan datos para agendar, pregunta SOLO por lo que falta, de forma natural.
- Si no entiendes algo, pregunta de forma natural confirmando tu mejor interpretación.
- Cada respuesta debe sentirse como parte de UNA sola conversación fluida.

Contexto de la situación actual: ${JSON.stringify(contexto)}

Responde SOLO con el mensaje final para el cliente, sin explicaciones ni comillas.`;

  const result = await llamarConRetry(() => model.generateContent(promptSistema));
  return result.response.text().trim();
}

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
              servicio: { type: 'string', description: 'Nombre del servicio, tal como aparece en el catálogo, o null' },
              barbero: { type: 'string', description: 'Nombre del barbero, o null si no tiene preferencia' },
              fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD, o null' },
              hora: { type: 'string', description: 'Hora en formato HH:MM, o null' },
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

Extrae los datos que el cliente menciona en este mensaje. Si menciona un servicio o barbero con errores de tipeo, corrígelo al nombre exacto del catálogo.`;

  const result = await llamarConRetry(() => model.generateContent(prompt));
  const call = result.response.functionCalls()?.[0];

  return call ? call.args : {};
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita };