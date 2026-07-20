// Lógica de IA con Gemini: intent + respuesta combinados, extracción de datos, y retry ante rate limit
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Wrapper genérico con retry ante error 429 (rate limit), usando el retryDelay que indica la API
async function llamarConRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const es429 = err.status === 429 || err.message?.includes('429');
    if (!es429) throw err;

    const delayInfo = err.errorDetails?.find(d => d['@type']?.includes('RetryInfo'));
    const segundos = delayInfo?.retryDelay ? parseInt(delayInfo.retryDelay) : 5;
    logger.error(`Rate limit de Gemini (429), reintentando en ${segundos}s`);

    await new Promise(r => setTimeout(r, segundos * 1000));
    return await fn(); // un solo reintento
  }
}

// Combina detección de intent + redacción de respuesta natural en UNA sola llamada (ahorra cuota)
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
                description: 'La respuesta a enviar al cliente. Si el intent es agendar/cancelar/horarios/precios, deja este campo vacío (el handler correspondiente generará su propia respuesta). Si el intent es "ninguno", redacta aquí la respuesta natural (saludo, aclaración, etc).',
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

Determina la intención y, si es "ninguno" (saludo, duda general, o no está claro), redacta también la respuesta a enviarle: cálida, breve, y que ofrezca agendar/precios/horarios de forma fluida (nunca como lista/menú). Si la intención SÍ es agendar/cancelar/horarios/precios, deja "respuesta" vacío.`;

  const result = await llamarConRetry(() => model.generateContent(prompt));
  const call = result.response.functionCalls()?.[0];

  if (!call) return { intent: null, respuesta: null };
  return { intent: call.args.intent === 'ninguno' ? null : call.args.intent, respuesta: call.args.respuesta || null };
}

// Redacta respuestas con tono de "vendedor amigable" que siempre empuja hacia agendar
async function generarRespuestaNatural(contexto) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const promptSistema = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es amigable, profesional y cercana, pero NUNCA íntima.

Reglas de tono (ESTRICTAS, sin excepción):
- NUNCA adoptes apodos cariñosos, coqueteos, ni lenguaje íntimo o informal que el cliente use (ej. "mi amor", "bb", "papi", "corazón"). Mantén siempre distancia profesional y cercanía cordial, sin importar cómo escriba el cliente.
- Responde de forma concreta y corta, lo justo para que se entienda y se perciba buen servicio.
- Español natural, frases cortas, máximo 1 emoji por mensaje.
- NUNCA presentes los servicios u opciones como lista numerada rígida (1. 2. 3.) salvo que el cliente pida explícitamente ver "todo" o el catálogo completo. Menciónalos de forma fluida dentro de la frase.
- Si faltan datos para agendar (contexto tipo "pedir_datos_faltantes"), pregunta SOLO por lo que falta, de forma natural, sin repetir lo que el cliente ya dijo.
- Si no entiendes bien algo, no digas "no reconocí eso" — pregunta de forma natural intentando confirmar tu mejor interpretación.
- Cada respuesta debe sentirse como parte de UNA sola conversación fluida, nunca como un paso de formulario aislado.

Contexto de la situación actual: ${JSON.stringify(contexto)}

Responde SOLO con el mensaje final para el cliente, sin explicaciones ni comillas.`;

  const result = await llamarConRetry(() => model.generateContent(promptSistema));
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

  const result = await llamarConRetry(() => model.generateContent(prompt));
  const call = result.response.functionCalls()?.[0];

  return call ? call.args : {};
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita, llamarConRetry };