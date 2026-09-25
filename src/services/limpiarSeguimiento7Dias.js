// bot/services/limpiarSeguimiento7Dias.js
//
// Si el vendedor se adelanta y le responde al cliente (o vuelve a tomar la
// conversación) antes de que el cliente conteste al mensaje de seguimiento de
// 7 días, hay que cortar la espera — sino el bot podría interpretar un mensaje
// futuro del cliente, ya sin relación con el seguimiento, como si fuera la
// respuesta a esa pregunta. El mensaje del bot en sí no se borra: queda
// oculto para vendedores y visible para admin/supervisor (ver
// procesarMensaje.js y el filtro en getConversaciones.js/getConversacionById.js).
// Se llama desde tomarConversacion.js y enviarMensaje.js.

const { Conversacion } = require("../db");

async function limpiarSeguimiento7Dias(conversacionId) {
  const conv = await Conversacion.findByPk(conversacionId);
  if (!conv || !conv.esperandoRespuestaSeguimiento7Dias) return;

  await conv.update({ esperandoRespuestaSeguimiento7Dias: false });
}

module.exports = { limpiarSeguimiento7Dias };
