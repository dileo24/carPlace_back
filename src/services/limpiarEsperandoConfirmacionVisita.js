// Si un admin/asesor toma control manual de una conversación (o le responde a
// mano) mientras el bot todavía está esperando que el cliente confirme/cancele
// la visita de hoy (EventoCalendario.esperandoConfirmacion = true, seteado por
// src/cronjobs/recordatorioVisitas.js), hay que cortar esa espera — sino
// procesarMensaje.js sigue dejando pasar al bot para ese teléfono puntual (el
// gate de estado !== "bot" tiene una excepción explícita para esperandoConfirmacion,
// pensada para cuando el propio bot derivó a asesor por otro motivo, no para
// cuando un humano tomó el chat a mano). Mismo criterio que
// limpiarSeguimiento7Dias.js, aplicado al recordatorio de visita.
// Se llama desde tomarConversacion.js, updateEstado.js y enviarMensaje.js.

const { Conversacion, EventoCalendario } = require("../db");
const { Op } = require("sequelize");
const hoyArgentina = require("./hoyArgentina");

async function limpiarEsperandoConfirmacionVisita(conversacionId) {
  const conv = await Conversacion.findByPk(conversacionId);
  if (!conv?.telefono) return;

  const telefonoNormalizado = conv.telefono;
  const hoy = hoyArgentina();

  await EventoCalendario.update(
    { esperandoConfirmacion: false },
    {
      where: {
        [Op.or]: [
          { clienteTelefono: telefonoNormalizado },
          { clienteTelefono: telefonoNormalizado.replace(/^549/, "") },
          { clienteTelefono: telefonoNormalizado.replace(/^54/, "") },
        ],
        fecha: hoy,
        esperandoConfirmacion: true,
      },
    },
  );
}

module.exports = { limpiarEsperandoConfirmacionVisita };
