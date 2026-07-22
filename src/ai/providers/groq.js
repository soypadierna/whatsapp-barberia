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

  const promptSistema = `Eres el asistente de WhatsApp de "${nombreBarberia}". Tu personalidad es amigable, profesional y cercana, pero NUNCA íntima.

Reglas de tono (ESTRICTAS, sin excepción):
- NUNCA adoptes apodos cariñosos, coqueteos, ni lenguaje íntimo o informal que el cliente use. Mantén siempre distancia profesional y cercanía cordial.
- Responde de forma concreta y corta.
- Español natural, frases cortas, máximo 1 emoji por mensaje.
- NUNCA presentes servicios como lista numerada rígida salvo que el cliente pida explícitamente el catálogo completo.
- Si faltan datos para agendar, pregunta SOLO por lo que falta, de forma natural.
- Si no entiendes algo, pregunta de forma natural confirmando tu mejor interpretación.
- Cada respuesta debe sentirse como parte de UNA sola conversación fluida.
- Cuando el contexto sea "mostrar_catalogo_inicial", presenta los servicios de forma fluida en una frase (no como lista numerada), y pregunta cuál le interesa.
- Cuando el contexto sea "ofrecer_tres_rutas", explica brevemente que ese horario no está libre y ofrece las opciones disponibles (rutaA=otras horas mismo día, rutaB=mismo horario otro día, rutaC=otro barbero mismo día/hora) SOLO las que no sean null, de forma conversacional, dejando que el cliente elija.
- Si el tipo de situación es "horario_no_disponible" y ya se dio una respuesta similar antes en la conversación, varía la redacción con sinónimos y estructura distinta, nunca repitas la misma frase textual dos veces seguidas.
- No incluyas tú mismo el checklist de campos (✅/⬜) en tu respuesta — eso se agrega aparte automáticamente.
- Cuando el contexto sea "confirmar_antes_de_guardar", presenta el resumen de forma natural y pregunta explícitamente si todo está correcto o si desea cambiar algo, antes de guardar (NO uses el checklist tú mismo, solo pregunta en prosa).
- Cuando el contexto sea "preguntar_que_cambiar", pregunta amablemente qué dato quiere modificar.
- Cuando el contexto sea "cita_cancelada_por_cliente", confirma amablemente que no se agendó nada y que puede volver cuando quiera.
- Cuando el contexto sea "repetir_confirmacion_no_claro", pregunta de nuevo de forma clara y directa si confirma la cita o desea cambiar algo (varía la redacción respecto a la pregunta anterior).
- FORMATO DE MENSAJES: escribe como se escribe realmente por WhatsApp, con mensajes cortos y saltos de línea, NUNCA como párrafo largo de folleto con todo encadenado en comas.
- Cuando presentes 2 o más opciones/alternativas (horarios, rutas de solución, servicios del catálogo completo), usa este formato:
  * Una frase corta de contexto/situación primero, en su propia línea
  * Línea en blanco
  * Cada opción en su propia línea, con emoji numerado (1️⃣ 2️⃣ 3️⃣) o viñeta (•)
  * Línea en blanco
  * Pregunta corta de cierre en su propia línea
- Ejemplo de formato esperado para "ofrecer_tres_rutas":
"Juan no tiene espacio a las 10 mañana 😕

Puedo ofrecerte:
1️⃣ 09:00, 09:30 o 10:30 con Juan
2️⃣ El mismo horario pero al día siguiente
3️⃣ Carlos está libre mañana a esa hora

¿Cuál prefieres?"
- Aplica este mismo formato de líneas separadas para "mostrar_otras_horas" y para "mostrar_catalogo_inicial" cuando haya más de 2 servicios.
- Para respuestas simples de un solo dato (pedir un campo, confirmaciones, saludos) sigue usando frases cortas normales, sin forzar el formato de lista si no hay múltiples opciones que mostrar.

Contexto de la situación actual: ${JSON.stringify(contexto)}

Responde SOLO con el mensaje final para el cliente, sin explicaciones ni comillas.`;

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: promptSistema }],
    })
  );

  return result.choices[0].message.content.trim();
}

function obtenerFechaHoyCR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' });
}

function obtenerDiaSemanaCR() {
  return new Date().toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'long' });
}

async function extraerDatosCita(texto, contextoActual, catalogos) {
  const hoy = obtenerFechaHoyCR();
  const diaSemanaHoy = obtenerDiaSemanaCR();

  const prompt = `Fecha de HOY: ${hoy} (${diaSemanaHoy}), zona horaria Costa Rica.
Catálogo de servicios: ${catalogos.servicios.map(s => s.nombre).join(', ')}.
Barberos: ${catalogos.barberos.map(b => b.nombre).join(', ')}.
Datos YA confirmados en turnos anteriores (NO los repitas ni los reescribas): ${JSON.stringify(contextoActual)}.
Mensaje NUEVO del cliente (analiza SOLO este mensaje): "${texto}"

REGLA CRÍTICA: solo llena un campo si el cliente lo menciona explícitamente EN ESTE mensaje. Si solo dice una hora, deja "fecha": null aunque haya una fecha ya conocida de antes.

REGLA DE FECHAS RELATIVAS (obligatoria, calcula con precisión):
- "hoy" = ${hoy}
- "mañana" = ${hoy} + 1 día exacto
- "pasado mañana" = ${hoy} + 2 días exactos
- "el [día de la semana]" = la próxima ocurrencia de ese día contando desde hoy (${diaSemanaHoy})
- Calcula SIEMPRE tomando como base literal la fecha de HOY indicada arriba.

IMPORTANTE: fecha y hora pueden venir juntas/pegadas o con errores de tipeo (ej. "20 juli2pm", "manana7pm"). Extrae ambos si están presentes.

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

async function interpretarConfirmacion(texto, datosActuales) {
  const prompt = `El cliente tiene esta cita pendiente de confirmar: ${JSON.stringify(datosActuales)}.
Respondió: "${texto}"

Determina si confirma la cita tal cual está, si quiere cambiar algo puntual, o si cancela. Sé generoso interpretando afirmaciones informales en español (ej. "todo bien", "esta correcto", "ok", "dale así", "perfecto", "confirmo" cuentan como confirmar).

Responde SOLO con JSON: {"accion": "confirmar|cambiar|cancelar|no_claro", "campo": "servicio|barbero|fecha|hora o vacío", "valorNuevo": "texto libre o vacío"}`;

  const result = await llamarConRetry(() =>
    groq.chat.completions.create({
      model: MODELO,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    })
  );

  const data = extraerJson(result.choices[0].message.content);
  logger.mensaje(`[interpretarConfirmacion/groq] texto="${texto}" → resultado=${JSON.stringify(data)}`);

  return data;
}
module.exports = { procesarMensajeInicial, generarRespuestaNatural, extraerDatosCita, interpretarConfirmacion };