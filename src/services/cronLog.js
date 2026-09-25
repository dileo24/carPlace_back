const { CronLog } = require("../db");

async function logCron(tipo, estado, mensaje, detalle = null) {
  try {
    await CronLog.create({ tipo, estado, mensaje, detalle });
  } catch (err) {
    console.error("❌ No se pudo guardar CronLog:", err.message);
  }
}

async function limpiarCronLogs() {
  const { Op } = require("sequelize");
  const hace3Dias = new Date();
  hace3Dias.setDate(hace3Dias.getDate() - 3);
  try {
    await CronLog.destroy({ where: { createdAt: { [Op.lt]: hace3Dias } } });
  } catch (err) {
    console.error("❌ Error limpiando CronLogs:", err.message);
  }
}

module.exports = { logCron, limpiarCronLogs };