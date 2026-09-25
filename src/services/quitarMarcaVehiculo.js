// bot/services/quitarMarcaVehiculo.js
//
// El bot pasa "vehiculo" como texto libre con marca+modelo (ej. "Volkswagen
// Golf Trendline 1.6"), pero el título del evento de calendario tiene que
// mostrar solo el modelo, sin la marca. En vez de confiar en que el modelo
// la omita al armar el string, se resuelve acá contra las marcas reales del
// stock — determinístico y no depende del prompt.

const { Auto } = require("../db");

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
let cache = { data: null, timestamp: 0 };

async function obtenerMarcas() {
  const ahora = Date.now();
  if (cache.data && ahora - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  let marcas = [];
  try {
    const autos = await Auto.findAll({ attributes: ["marca"], group: ["marca"] });
    marcas = [...new Set(autos.map(a => a.marca).filter(Boolean))].sort(
      (a, b) => b.length - a.length,
    ); // más larga primero, evita cortes parciales
  } catch (e) {
    console.warn("⚠️ No se pudo obtener lista de marcas:", e.message);
    marcas = [];
  }

  cache = { data: marcas, timestamp: ahora };
  return marcas;
}

async function quitarMarca(vehiculo) {
  if (!vehiculo) return vehiculo;
  const marcas = await obtenerMarcas();
  const vehiculoLower = vehiculo.toLowerCase();
  const marcaEncontrada = marcas.find(
    marca =>
      vehiculoLower === marca.toLowerCase() ||
      vehiculoLower.startsWith(`${marca.toLowerCase()} `),
  );
  if (!marcaEncontrada) return vehiculo;
  return vehiculo.slice(marcaEncontrada.length).trim();
}

module.exports = { quitarMarca };
