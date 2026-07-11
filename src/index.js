// Diagnóstico temporal: imprime variables de entorno relacionadas y mantiene el proceso vivo
console.log('--- Variables de entorno disponibles ---');
Object.keys(process.env)
  .filter(k => k.includes('SUPABASE') || k.includes('GEMINI') || k.includes('GOOGLE') || k.includes('ADMIN'))
  .forEach(k => console.log(k, '=', process.env[k] ? '(tiene valor)' : '(vacío)'));

console.log('--- Total de variables en process.env:', Object.keys(process.env).length);

// Mantiene el proceso vivo para poder usar la shell de Railway
setInterval(() => {}, 1000 * 60 * 60);