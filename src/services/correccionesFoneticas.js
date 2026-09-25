// bot/services/correccionesFoneticas.js
//
// Correcciones de texto para confusiones fonéticas conocidas entre Whisper
// y jerga de la concesionaria. Es una red de seguridad barata (regex, sin
// llamadas a IA) que actúa DESPUÉS de la transcripción y ANTES de interpretar
// la intención — así, aunque el prompt de vocabulario de Whisper no alcance,
// estos casos puntuales ya detectados quedan cubiertos.
//
// Agregar acá cualquier confusión nueva que se detecte en producción.

const CONFUSIONES = [
  // Ford Ka ↔ "foto 4K" / "foto 4 k"
  { patron: /\bfotos?\s*4\s*k\b/gi, reemplazo: "Ford Ka" },
];

function aplicarCorreccionesConocidas(texto) {
  if (!texto) return texto;
  let resultado = texto;
  for (const { patron, reemplazo } of CONFUSIONES) {
    resultado = resultado.replace(patron, reemplazo);
  }
  return resultado;
}

module.exports = { aplicarCorreccionesConocidas };