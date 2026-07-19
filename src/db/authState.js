// Estado de autenticación de Baileys persistido en Supabase (en vez de archivos locales)
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { supabase } = require('./client');

const logger = require('../utils/logger');

// Guarda un valor en la tabla auth_sessions (serializado con BufferJSON para soportar Buffers)
async function guardarDato(id, valor) {
  const data = JSON.parse(JSON.stringify(valor, BufferJSON.replacer));
  const { error } = await supabase.from('auth_sessions').upsert({ id, data, updated_at: new Date().toISOString() });
  if (error) logger.error(`Fallo al guardar sesión (${id})`, error.message);
  else logger.sesion(`Guardado OK: ${id}`);
}

// Lee un valor de la tabla auth_sessions
async function leerDato(id) {
  const { data, error } = await supabase.from('auth_sessions').select('data').eq('id', id).maybeSingle();
  if (error) logger.error(`Fallo al leer sesión (${id})`, error.message);
  if (!data) return null;
  return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
}

// Elimina un valor
async function eliminarDato(id) {
  await supabase.from('auth_sessions').delete().eq('id', id);
}

// Genera el authState compatible con Baileys usando Supabase como almacenamiento
async function useSupabaseAuthState() {
  const credsExistentes = await leerDato('creds');
  const creds = credsExistentes || initAuthCreds();

  const keys = {
    get: async (type, ids) => {
      const data = {};
      await Promise.all(
        ids.map(async (id) => {
          const valor = await leerDato(`${type}-${id}`);
          if (valor) data[id] = valor;
        })
      );
      return data;
    },
    set: async (data) => {
      const tareas = [];
      for (const categoria in data) {
        for (const id in data[categoria]) {
          const valor = data[categoria][id];
          const key = `${categoria}-${id}`;
          tareas.push(valor ? guardarDato(key, valor) : eliminarDato(key));
        }
      }
      await Promise.all(tareas);
    },
  };

  const saveCreds = async () => {
    await guardarDato('creds', creds);
  };

  return { state: { creds, keys }, saveCreds };
}

// Borra todos los registros de auth_sessions (fuerza generación de QR nuevo)
async function limpiarSesionCompleta() {
  const { error } = await supabase.from('auth_sessions').delete().neq('id', '');
  if (error) console.error('Error limpiando sesión:', error.message);
  else console.log('🧹 Sesión de Supabase limpiada por logout detectado');
}

// Guarda/lee el número de WhatsApp vinculado actualmente, para detectar cambios de número
async function guardarNumeroVinculado(numero) {
  const { error } = await supabase.from('auth_sessions').upsert({
    id: 'numero_vinculado',
    data: { numero },
    updated_at: new Date().toISOString(),
  });
  if (error) logger.error('Fallo guardando numero_vinculado', error.message);
}

async function leerNumeroVinculado() {
  const { data, error } = await supabase
    .from('auth_sessions').select('data').eq('id', 'numero_vinculado').maybeSingle();
  if (error) {
    logger.error('Fallo leyendo numero_vinculado', error.message);
    return null;
  }
  return data?.data?.numero || null;
}

module.exports = { useSupabaseAuthState, limpiarSesionCompleta, guardarNumeroVinculado, leerNumeroVinculado };