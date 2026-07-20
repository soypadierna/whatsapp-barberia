// Implementación del proveedor Groq (mismo contrato que ../ai/provider espera)
const Groq = require('groq-sdk');
require('dotenv').config();
const logger = require('../../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO = 'llama-3.3-70b-versatile';

// Retry con backoff para errores temporales (429 rate limit, 503 service unavailable)
async function llamarConRetry(fn) {
  const backoffs = [2000, 5000, 10000];

  for (let intento = 0; intento <= backoffs.length; intento++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.response?.status;
      const esTemporal = status === 429 || status === 503;

      if (!esTemporal) throw err;
      if (intento === backoffs.length) throw err;

      const esperaMs = backoffs[intento];
      logger.error(`Error temporal de Groq (${status}), reintento ${intento + 1}/${backoffs.length} en ${esperaMs / 1000}s`);
      await new Promise(r => setTimeout(r, esperaMs));
    }
  }
}

// Extrae el primer bloque JSON de un texto (por si el modelo agrega texto extra alrededor)
function extraerJson(texto) {
  const match = texto.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : {};
}

async function procesarMensajeInicial(texto) {
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const prompt = `Eres el asistente de WhatsApp de "${nombreBarberia}". Personalidad amigable, profesional, cercana pero NUNCA íntima (nunca adoptes apodos cariñosos o tono coqueto del cliente, sin excepción). Respuestas cortas y concretas, máximo 1 emoji.

Mensaje del cliente: "${texto}"

Determina la intención del cliente entre: agendar, cancelar, horarios, precios, o ninguno (saludo/no claro). Si es "ninguno", redacta también la respuesta a enviarle: cálida, breve, que ofrezca agendar/precios/horarios de forma fluida (nunca como lista/menú).

Responde SOLO con un JSON válido, sin texto adicional, con este formato exacto:
{"intent": "agendar|cancelar|horarios|precios|ninguno", "respuesta": "texto o cadena vacía"}`;

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })
  );

  const data = extraerJson(result.choices[0].message.content);
  if (!data.intent) return { intent: null, respuesta: null };

  return { intent: data.intent === 'ninguno' ? null : data.intent, respuesta: data.respuesta || null };
}

async function generarRespuestaNatural(contexto) {
  const nombreBarberia = process.env.NOMBRE_BARBERIA || 'la barbería';

  const prompt = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es amigable, profesional y cercana, pero NUNCA íntima.

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

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
    })
  );

  return result.choices[0].message.content.trim();
}

async function extraerDatosCita(texto, contextoActual, catalogos) {
  const hoy = new Date().toISOString().split('T')[0];

  const prompt = `Fecha de hoy: ${hoy}.
Catálogo de servicios disponibles: ${catalogos.servicios.map(s => s.nombre).join(', ')}.
Barberos disponibles: ${catalogos.barberos.map(b => b.nombre).join(', ')}.
Datos ya conocidos de esta conversación: ${JSON.stringify(contextoActual)}.
Mensaje nuevo del cliente: "${texto}"

Extrae los datos que el cliente menciona en este mensaje (puede mencionar uno, varios, o ninguno). Si menciona un servicio o barbero con errores de tipeo, corrígelo al nombre exacto del catálogo. Interpreta fechas relativas ("hoy", "mañana", días de la semana) contra la fecha de hoy.

Responde SOLO con un JSON válido, sin texto adicional, con este formato exacto:
{"servicio": "nombre o null", "barbero": "nombre o null", "fecha": "YYYY-MM-DD o null", "hora": "HH:MM o null"}`;

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })
  );

  const data = extraerJson(result.choices[0].message.content);

  // Normaliza "null" (string) a null real, por si el modelo lo devuelve como texto
  Object.keys(data).forEach(k => { if (data[k] === 'null') data[k] = null; });

  return data;
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita };