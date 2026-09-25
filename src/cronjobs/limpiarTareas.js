const cron = require("node-cron");
const { Op } = require("sequelize");
const { Tarea } = require("../db");
const { logCron } = require("../services/cronLog");

// Se ejecuta todos los días a las 03:00
cron.schedule("0 3 * * *", async () => {
  console.log("[CRON] Limpiando tareas completadas/canceladas antiguas...");
  try {
    const hace7dias = new Date();
    hace7dias.setDate(hace7dias.getDate() - 7);

    const eliminadas = await Tarea.destroy({
      where: {
        estado: { [Op.in]: ["completada", "cancelada"] },
        // actualizadoEn es cuando cambió de estado por última vez
        actualizadoEn: { [Op.lt]: hace7dias },
      },
    });

    console.log(`[CRON] ${eliminadas} tareas eliminadas.`);
    await logCron("limpieza_tareas", "ok", `${eliminadas} tareas eliminadas.`);
  } catch (err) {
    console.error("[CRON] Error al limpiar tareas:", err);
    await logCron("limpieza_tareas", "error", "Error al limpiar tareas", err.message);
  }
});