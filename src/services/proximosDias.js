// bot/services/proximosDias.js
//
// Genera la lista de los próximos N días (por defecto 14) con fecha ISO y
// nombre del día de la semana. Se usa tanto en buildSystemPrompt.js (para
// mostrarle la tabla al bot) como en procesarMensaje.js (para cruzarla contra
// feriados antes de pasarla al prompt).

function obtenerProximosDias(cantidad = 14) {
  const hoyISO = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Cordoba",
  }); // "YYYY-MM-DD"
  const [y, m, d] = hoyISO.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12)); // mediodía UTC, evita corrimientos por huso horario

  const dias = [];
  for (let i = 0; i < cantidad; i++) {
    const fecha = new Date(base.getTime() + i * 86400000);
    const iso = fecha.toISOString().split("T")[0];
    const nombreDia = fecha.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
    dias.push({ iso, nombreDia, esHoy: i === 0 });
  }
  return dias;
}

module.exports = { obtenerProximosDias };