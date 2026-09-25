// cronjobs/limpiarConsultas.js
const cron = require("node-cron");
const { Op } = require("sequelize");
const { Consulta, ConsultaHistorial } = require("../db");
const { logCron } = require("../services/cronLog");

const ESTADOS_CIERRE = ["cerrado", "perdido"];

// Se ejecuta todos los días a las 03:30
cron.schedule("30 3 * * *", async () => {
  console.log("[CRON] Limpiando consultas sin movimiento...");
  try {
    const hace2meses = new Date();
    hace2meses.setMonth(hace2meses.getMonth() - 2);

    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);

    // Buscar consultas viejas según su estado:
    // - cerrado/perdido: 2 meses sin movimiento
    // - cualquier otro estado: 3 meses sin movimiento
    // En ambos casos, si estadoCambiadoEn es null, usamos updatedAt como fallback.
    const viejas = await Consulta.findAll({
      where: {
        [Op.or]: [
          // Cerradas o perdidas — umbral de 2 meses
          {
            estado: { [Op.in]: ESTADOS_CIERRE },
            [Op.or]: [
              { estadoCambiadoEn: { [Op.lt]: hace2meses } },
              { estadoCambiadoEn: null, updatedAt: { [Op.lt]: hace2meses } },
            ],
          },
          // Resto de estados — umbral de 3 meses
          {
            estado: { [Op.notIn]: ESTADOS_CIERRE },
            [Op.or]: [
              { estadoCambiadoEn: { [Op.lt]: hace3meses } },
              { estadoCambiadoEn: null, updatedAt: { [Op.lt]: hace3meses } },
            ],
          },
        ],
      },
      attributes: ["id", "estado"],
    });

    if (viejas.length === 0) {
      console.log("[CRON] No hay consultas viejas para eliminar.");
      await logCron("limpieza_consultas", "ok", "No había consultas viejas para eliminar.");
      return;
    }

    const ids = viejas.map(c => c.id);
    const cantidadCierre = viejas.filter(c => ESTADOS_CIERRE.includes(c.estado)).length;
    const cantidadOtras = viejas.length - cantidadCierre;

    // Eliminar historial primero (FK)
    await ConsultaHistorial.destroy({ where: { consultaId: { [Op.in]: ids } } });

    // Eliminar consultas
    const eliminadas = await Consulta.destroy({ where: { id: { [Op.in]: ids } } });

    const resumen = `${eliminadas} consultas eliminadas (${cantidadCierre} cerradas/perdidas con 2+ meses, ${cantidadOtras} en otros estados con 3+ meses).`;
    console.log(`[CRON] ${resumen}`);
    await logCron("limpieza_consultas", "ok", resumen);
  } catch (err) {
    console.error("[CRON] Error al limpiar consultas:", err);
    await logCron("limpieza_consultas", "error", "Error al limpiar consultas", err.message);
  }
});
