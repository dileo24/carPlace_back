const FERIADOS_CERRADO_TOTAL = ["01-01", "05-01", "12-25"];

let feriadosCache = [];
let ultimaActualizacion = null;

const getFeriados = async () => {
  const ahora = new Date();
  const veinticuatroHoras = 24 * 60 * 60 * 1000;

  if (ultimaActualizacion && ahora - ultimaActualizacion < veinticuatroHoras) {
    return feriadosCache;
  }

  try {
    const anio = ahora.getFullYear();
    const anioSiguiente = anio + 1;

    const [res1, res2] = await Promise.all([
      fetch(`https://api.argentinadatos.com/v1/feriados/${anio}`),
      fetch(`https://api.argentinadatos.com/v1/feriados/${anioSiguiente}`),
    ]);

    const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
    const todos = [...(Array.isArray(data1) ? data1 : []), ...(Array.isArray(data2) ? data2 : [])];
    feriadosCache = todos.map(f => f.fecha);
    ultimaActualizacion = ahora;
    console.log(
      `📅 Feriados actualizados: ${feriadosCache.length} feriados (${anio}-${anioSiguiente})`,
    );
  } catch (err) {
    console.warn("⚠️ No se pudieron obtener feriados:", err.message);
  }

  return feriadosCache;
};

// Devuelve: "cerrado", "solo_maniana", o null (día normal), para UNA fecha puntual
const estadoFeriado = async fechaISO => {
  const feriados = await getFeriados();
  if (!feriados.includes(fechaISO)) return null;

  const mesdia = fechaISO.slice(5); // "06-15"
  if (FERIADOS_CERRADO_TOTAL.includes(mesdia)) return "cerrado";
  return "solo_maniana";
};

// Evalúa VARIAS fechas de una sola vez, sin disparar múltiples fetches en paralelo.
// getFeriados() se llama y se espera UNA sola vez acá; el resto de la evaluación es
// puramente en memoria contra el array ya cacheado. Usar esta versión (en vez de
// llamar a estadoFeriado() en un Promise.all) cada vez que se necesite evaluar
// varios días juntos — por ejemplo, para la tabla de próximos 14 días del bot.
const estadoFeriadoMultiple = async fechasISO => {
  const feriados = await getFeriados();
  return fechasISO.map(fechaISO => {
    if (!feriados.includes(fechaISO)) return { fecha: fechaISO, estado: null };
    const mesdia = fechaISO.slice(5);
    const estado = FERIADOS_CERRADO_TOTAL.includes(mesdia) ? "cerrado" : "solo_maniana";
    return { fecha: fechaISO, estado };
  });
};

module.exports = { getFeriados, estadoFeriado, estadoFeriadoMultiple };
