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
- Si el tipo de situación es "horario_no_disponible" y ya se dio una respuesta similar antes en la conversación, varía la redacción: usa sinónimos y estructura de frase distinta cada vez, nunca repitas la misma frase textual dos veces seguidas.
- Si sugerenciaTipo es "otro_barbero_mismo_dia", deja claro que el barbero original no tenía espacio pero otro sí, y menciona el nombre del barbero sugerido. Si es "mismo_barbero_otro_dia", deja claro que fue necesario cambiar de fecha.

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
Catálogo de servicios: ${catalogos.servicios.map(s => s.nombre).join(', ')}.
Barberos: ${catalogos.barberos.map(b => b.nombre).join(', ')}.
Datos YA confirmados en turnos anteriores (NO los repitas ni los reescribas): ${JSON.stringify(contextoActual)}.
Mensaje NUEVO del cliente (analiza SOLO este mensaje): "${texto}"

REGLA CRÍTICA: solo llena un campo si el cliente lo menciona explícitamente EN ESTE mensaje puntual. Si el cliente solo dice una hora, NO asumas ni inventes una fecha — deja "fecha": null aunque haya una fecha ya conocida de antes.

Responde SOLO con JSON: {"servicio": "nombre o null", "barbero": "nombre o null", "fecha": "YYYY-MM-DD o null", "hora": "HH:MM o null"}`;

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })
  );

  const data = extraerJson(result.choices[0].message.content);
  Object.keys(data).forEach(k => { if (data[k] === 'null') data[k] = null; });
  return data;
}

module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita };