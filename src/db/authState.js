// Estado de autenticación de Baileys persistido en Supabase (en vez de archivos locales)
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { supabase } = require('./client');

// Guarda un valor en la tabla auth_sessions (serializado con BufferJSON para soportar Buffers)
async function guardarDato(id, valor) {
  const data = JSON.parse(JSON.stringify(valor, BufferJSON.replacer));
  await supabase.from('auth_sessions').upsert({ id, data, updated_at: new Date().toISOString() });
}

// Lee un valor de la tabla auth_sessions
async function leerDato(id) {
  const { data } = await supabase.from('auth_sessions').select('data').eq('id', id).maybeSingle();
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

module.exports = { useSupabaseAuthState };