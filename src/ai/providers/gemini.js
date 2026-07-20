// Implementación del proveedor Gemini (mismo contrato que ../ai/provider espera)
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
- Si el tipo de situación es "horario_no_disponible" y ya se dio una respuesta similar antes en la conversación, varía la redacción: usa sinónimos y estructura de frase distinta cada vez, nunca repitas la misma frase textual dos veces seguidas.
- Si sugerenciaTipo es "otro_barbero_mismo_dia", deja claro que el barbero original no tenía espacio pero otro sí, y menciona el nombre del barbero sugerido. Si es "mismo_barbero_otro_dia", deja claro que fue necesario cambiar de fecha.

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
          description: 'Extrae SOLO los datos que el cliente menciona explícitamente en este mensaje puntual',
          parameters: {
            type: 'object',
            properties: {
              servicio: { type: 'string', description: 'Nombre del servicio del catálogo, SOLO si se menciona en este mensaje' },
              barbero: { type: 'string', description: 'Nombre del barbero, SOLO si se menciona en este mensaje' },
              fecha: { type: 'string', description: 'Fecha YYYY-MM-DD, SOLO si el cliente menciona una fecha o referencia temporal ("hoy", "mañana", día de la semana) explícitamente EN ESTE mensaje' },
              hora: { type: 'string', description: 'Hora HH:MM, SOLO si se menciona en este mensaje' },
            },
          },
        },
      ],
    },
  ];

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview', tools: toolsExtraccion });
  const hoy = new Date().toISOString().split('T')[0];

  const prompt = `Fecha de hoy: ${hoy}.
Catálogo de servicios: ${catalogos.servicios.map(s => s.nombre).join(', ')}.
Barberos: ${catalogos.barberos.map(b => b.nombre).join(', ')}.
Datos YA confirmados en turnos anteriores (NO los repitas ni los reescribas): ${JSON.stringify(contextoActual)}.
Mensaje NUEVO del cliente (analiza SOLO este mensaje): "${texto}"

REGLA CRÍTICA: solo llena un campo si el cliente lo menciona explícitamente EN ESTE mensaje puntual. Si el cliente solo dice una hora (ej. "a las 10am"), NO asumas ni inventes una fecha — deja fecha vacío/ausente aunque haya una fecha ya conocida de antes. Nunca "completes" un campo con un valor implícito o supuesto.`;

  const result = await llamarConRetry(() => model.generateContent(prompt));
  const call = result.response.functionCalls()?.[0];

  return call ? call.args : {};
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita };