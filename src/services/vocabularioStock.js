// bot/services/vocabularioStock.js
//
// Vocabulario de modelos en stock, usado para:
//  1. Sesgar la transcripción de Whisper (parámetro `prompt`)
//  2. Darle contexto al GPT que interpreta la intención, para que pueda
//     corregir menciones fonéticamente parecidas (ej: "foto 4K" → "Ford Ka")
//
// Se cachea en memoria porque no hace falta consultar la DB en cada audio —
// el stock no cambia tan seguido como para justificar una query por mensaje.

const { Auto } = require("../db");

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
let cache = { data: null, timestamp: 0 };

async function obtenerVocabularioAutos() {
  const ahora = Date.now();
  if (cache.data && ahora - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  let nombres = [];
  try {
    const autos = await Auto.findAll({
      attributes: ["marca", "modelo"],
      group: ["marca", "modelo"],
      limit: 150, // evitar prompts gigantes si el stock crece mucho
    });
    nombres = [...new Set(autos.map(a => `${a.marca} ${a.modelo}`.trim()).filter(Boolean))];
  } catch (e) {
    console.warn("⚠️ No se pudo obtener vocabulario de stock:", e.message);
    nombres = [];
  }

  const promptWhisper = nombres.length
    ? `Modelos de autos que puede mencionar el hablante: ${nombres.join(", ")}.`
    : "";

  const data = { promptWhisper, listaPlano: nombres };
  cache = { data, timestamp: ahora };
  return data;
}

// Permite forzar refresco manual si hace falta (ej: tras cargar un auto nuevo)
function invalidarCache() {
  cache = { data: null, timestamp: 0 };
}

module.exports = { obtenerVocabularioAutos, invalidarCache };