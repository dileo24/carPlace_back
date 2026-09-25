const cron = require("node-cron");
const { Op } = require("sequelize");
const { Publicacion } = require("../db");
const { logCron } = require("../services/cronLog");
const { eliminarPublicacionMercadoLibre } = require("../services/mercadolibreListingsService");

// Se ejecuta todos los días a las 04:00 — elimina en MercadoLibre (no solo
// cierra) las publicaciones que llegaron a sus 60 días, para que no quede
// acumulando publicaciones "Inactivas" viejas y mantener el flujo de
// publicaciones nuevas en la cuenta. No republica solo: el admin decide si
// quiere volver a publicar desde el módulo (ver republicarPublicacion.js).
cron.schedule("0 4 * * *", async () => {
  console.log("[CRON] Revisando publicaciones vencidas...");
  try {
    const vencidas = await Publicacion.findAll({
      where: {
        estado: "publicada",
        expiraEn: { [Op.lte]: new Date() },
      },
    });

    let eliminadas = 0;
    for (const publicacion of vencidas) {
      try {
        await eliminarPublicacionMercadoLibre(publicacion.externalId);
        await publicacion.update({ estado: "eliminada" });
        eliminadas++;
      } catch (err) {
        console.error(`[CRON] Error eliminando publicación ${publicacion.id}:`, err.message);
        await publicacion.update({ ultimoErrorMensaje: err.message });
      }
    }

    console.log(`[CRON] ${eliminadas} publicaciones eliminadas por vencimiento.`);
    await logCron("expirar_publicaciones", "ok", `${eliminadas} publicaciones eliminadas por vencimiento.`);
  } catch (err) {
    console.error("[CRON] Error revisando publicaciones vencidas:", err);
    await logCron("expirar_publicaciones", "error", "Error revisando publicaciones vencidas", err.message);
  }
});
