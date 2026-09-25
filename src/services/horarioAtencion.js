// bot/services/horarioAtencion.js
//
// Validación server-side, determinística, de que una fecha/hora de visita
// caiga dentro del horario real de atención. Hasta ahora esta regla vivía
// SOLO como texto en el prompt del LLM (buildSystemPrompt.js) — si el modelo
// fallaba en aplicarla (o el cliente insistía), no había ningún guardarraíl
// de código que lo impidiera. Se usa en procesarMensaje.js, casos
// "agendarVisita" y "confirmarVisita".
const { estadoFeriado } = require("./feriados");

const FRANJAS_HABIL = [
  [9 * 60 + 30, 13 * 60], // 09:30–13:00
  [16 * 60, 20 * 60], // 16:00–20:00
];
const FRANJA_SOLO_MANIANA = [[9 * 60 + 30, 13 * 60]];

function minutosDesdeHHMM(horaInicio) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((horaInicio || "").trim());
  if (!match) return null;
  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (horas > 23 || minutos > 59) return null;
  return horas * 60 + minutos;
}

// Mismo criterio que proximosDias.js: ancla al mediodía UTC para no correrse
// de día por huso horario al calcular el día de la semana.
function diaDeSemana(fechaISO) {
  const [y, m, d] = (fechaISO || "").split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=domingo ... 6=sábado
}

// Devuelve { valida: true } o { valida: false, motivo: "..." }
async function validarFechaHoraVisita(fechaISO, horaInicio) {
  const minutos = minutosDesdeHHMM(horaInicio);
  if (minutos == null) {
    return {
      valida: false,
      motivo: `El horario "${horaInicio}" no es válido (formato esperado HH:MM).`,
    };
  }

  const dia = diaDeSemana(fechaISO);
  if (dia === 0 || dia === 6) {
    return {
      valida: false,
      motivo: "Los sábados y domingos el local permanece cerrado, sin excepción — no se pueden agendar visitas esos días.",
    };
  }

  const feriado = await estadoFeriado(fechaISO);
  if (feriado === "cerrado") {
    return {
      valida: false,
      motivo: `El ${fechaISO} es feriado y el local permanece cerrado — no se pueden agendar visitas ese día.`,
    };
  }

  const franjas = feriado === "solo_maniana" ? FRANJA_SOLO_MANIANA : FRANJAS_HABIL;
  const dentroDeFranja = franjas.some(([inicio, fin]) => minutos >= inicio && minutos < fin);
  if (!dentroDeFranja) {
    const franjasTexto =
      feriado === "solo_maniana"
        ? "09:30 a 13:00 (el local abre solo a la mañana por ser feriado)"
        : "09:30 a 13:00 o de 16:00 a 20:00";
    return {
      valida: false,
      motivo: `El horario ${horaInicio} está fuera del horario de atención (de ${franjasTexto}).`,
    };
  }

  return { valida: true };
}

module.exports = { validarFechaHoraVisita };
