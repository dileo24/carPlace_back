// bot/services/hoyArgentina.js
//
// `new Date().toISOString().split("T")[0]` da la fecha en UTC, no en hora
// argentina — entre las 21:00 y las 23:59 (hora AR) ya muestra el día
// siguiente, rompiendo cualquier comparación contra `fecha` de EventoCalendario
// (confirmarVisita, cancelarVisita, etc.). Mismo criterio que ya usa
// obtenerProximosDias.js para evitar ese corrimiento.
function hoyArgentina() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Cordoba",
  }); // "YYYY-MM-DD"
}

module.exports = hoyArgentina;
