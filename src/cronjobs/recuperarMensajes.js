const cron = require("node-cron");
const { Op } = require("sequelize");
const { logCron } = require("../services/cronLog");

// Se ejecuta cada 5 minutos
cron.schedule("*/5 * * * *", async () => {
  try {
    const { Mensaje, Conversacion } = require("../db");
    const {
      procesando,
      timers,
      mensajesBuffer,
      ejecutarBot,
    } = require("../middlewares/crm/conversaciones/webhookWhatsApp");

    const pendientes = await Mensaje.findAll({
      where: {
        procesado: false,
        tipo: "entrante",
        createdAt: { [Op.lt]: new Date(Date.now() - 120000) }, // más de 2min sin procesar
      },
      include: [{ model: Conversacion, as: "Conversacion" }],
      order: [["createdAt", "ASC"]],
    });

    if (!pendientes.length) return;

    console.log(`[CRON] ${pendientes.length} mensajes sin procesar encontrados`);

    for (const msg of pendientes) {
      const conv = msg.Conversacion;
      if (!conv) continue;
      if (conv.estado !== "bot") continue;
      if (procesando.has(conv.id)) continue;
      if (timers[conv.id]) continue;
      if (mensajesBuffer[conv.id]?.length) continue;

      const huboMensajeMasNuevoYaProcesado = await Mensaje.findOne({
        where: {
          conversacionId: conv.id,
          tipo: "entrante",
          procesado: true,
          createdAt: { [Op.gt]: msg.createdAt },
        },
      });

      if (huboMensajeMasNuevoYaProcesado) {
        await Mensaje.update({ procesado: true }, { where: { id: msg.id, procesado: false } });
        console.log(
          `[CRON] Mensaje ${msg.id} conv ${conv.id} descartado por obsoleto (ya hubo respuesta posterior)`,
        );
        continue;
      }

      const [filasActualizadas] = await Mensaje.update(
        { procesado: true },
        { where: { id: msg.id, procesado: false } },
      );
      if (filasActualizadas === 0) continue;

      console.log(`[CRON] Reintentando mensaje ${msg.id} conv ${conv.id}`);
      await ejecutarBot(conv, conv.telefono, msg.texto, [msg]);
    }
  } catch (err) {
    console.error("[CRON] Error en recuperarMensajes:", err.message);
    await logCron("recuperar_mensajes", "error", "Error en recuperarMensajes", err.message);
  }
});
