let cache = { valor: null, timestamp: 0 };
const TTL = 12 * 60 * 60 * 1000; // 12 horas

async function getDolarBlue() {
  const ahora = Date.now();
  if (cache.valor && ahora - cache.timestamp < TTL) {
    return cache.valor;
  }

  try {
    const res = await fetch("https://api.bluelytics.com.ar/v2/latest");
    const data = await res.json();
    const valor = data?.blue?.value_sell;
    if (valor) {
      cache = { valor, timestamp: ahora };
      return valor;
    }
  } catch (e) {
    console.warn("⚠️ No se pudo obtener el dólar blue:", e.message);
  }

  // Si falla, devolvé el cache viejo si existe, o null
  return cache.valor || null;
}

module.exports = { getDolarBlue };
