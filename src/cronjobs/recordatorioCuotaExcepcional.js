// ⚠️ CASO EXCEPCIONAL Y TEMPORAL — recordatorio mensual de pago de cuota para
// un único cliente puntual (Peugeot 408 Allure Navegador 2.0 2012, 18 cuotas
// arrancando el 10/10/2026). No es una funcionalidad general del CRM: cuando
// las 18 cuotas terminen de enviarse (o antes, si el admin lo pide) se borra
// este archivo, el require en index.js, y la fila de Configuracion.
//
// Para activarlo falta cargar el teléfono real del cliente en la fila de
// Configuracion (clave RECORDATORIO_CUOTA_CLAVE) — sin eso, este cron no
// manda nada (se queda esperando en silencio).
const cron = require("node-cron");
const { Configuracion } = require("../db");
const { sendWhatsAppTemplate, sendWhatsAppMessage } = require("../services/whatsapp");
const { logCron } = require("../services/cronLog");
const hoyArgentina = require("../services/hoyArgentina");

const RECORDATORIO_CUOTA_CLAVE = "recordatorio_cuota_excepcional_408";

function mesesDeDiferencia(desde, hasta) {
  return (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
}

async function verificarYEnviarRecordatorio() {
  try {
    const config = await Configuracion.findOne({ where: { clave: RECORDATORIO_CUOTA_CLAVE } });
    if (!config || !config.valor) return; // no configurado todavía — no hacer nada

    const { telefono, nombre, monto, vehiculo, primeraFecha, totalCuotas, ultimoMesEnviado } = config.valor;
    if (!telefono || !nombre || !monto || !vehiculo || !primeraFecha || !totalCuotas) return;

    const hoyISO = hoyArgentina(); // "YYYY-MM-DD"
    const [y, m, d] = hoyISO.split("-").map(Number);
    if (d !== 10) return; // solo el día 10 (sin catch-up: es un caso puntual, se revisa a mano si falla)

    const mesActualKey = `${y}-${String(m).padStart(2, "0")}`;
    if (ultimoMesEnviado === mesActualKey) return; // ya se mandó este mes, no duplicar

    const [py, pm] = primeraFecha.split("-").map(Number);
    const cuotaActual = mesesDeDiferencia(new Date(py, pm - 1, 1), new Date(y, m - 1, 1)) + 1;
    if (cuotaActual < 1 || cuotaActual > totalCuotas) return; // fuera del rango de las 18 cuotas

    const montoFormateado = Number(monto).toLocaleString("es-AR");

    const mensajeLibre =
      `Hola ${nombre}, ¿cómo estás?\n\n` +
      `Te enviamos este mensaje a modo de recordatorio: el próximo día 10 corresponde el vencimiento de tu cuota mensual de $${montoFormateado}.\n\n` +
      `El pago se realiza personalmente en Av. Caraffa 2247, en nuestros horarios de atención:\n` +
      `9:30 a 13:00 hs. | 16:00 a 20:00 hs.\n\n` +
      `Cuando puedas, te pedimos que nos confirmes aproximadamente en qué horario vas a pasar, así podemos aguardarte.\n\n` +
      `Este aviso se envía automáticamente con anticipación para facilitar la organización de los pagos.\n\n` +
      `Sportquatro Automotores`;

    try {
      await sendWhatsAppTemplate(telefono, "recordatorio_cuota_pago", [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "nombre", text: nombre },
            { type: "text", parameter_name: "monto", text: montoFormateado },
          ],
        },
      ]);
    } catch (err) {
      console.warn("⚠️ Template de recordatorio de cuota falló, uso mensaje libre:", err.response?.data || err.message);
      await sendWhatsAppMessage(telefono, mensajeLibre);
    }

    await Configuracion.update(
      { valor: { ...config.valor, ultimoMesEnviado: mesActualKey } },
      { where: { clave: RECORDATORIO_CUOTA_CLAVE } },
    );

    await logCron(
      "recordatorio_cuota_excepcional",
      "ok",
      `Recordatorio de cuota ${cuotaActual}/${totalCuotas} enviado a ${telefono}`,
    );
  } catch (err) {
    console.error("❌ Error en recordatorioCuotaExcepcional:", err.message);
    await logCron("recordatorio_cuota_excepcional", "error", "Error enviando recordatorio de cuota", err.message);
  }
}

// Corre todos los días a las 9:00 — la función misma decide si hoy es el
// día 10 y si corresponde mandar algo.
cron.schedule("0 9 * * *", verificarYEnviarRecordatorio, { timezone: "America/Argentina/Cordoba" });

module.exports = { verificarYEnviarRecordatorio, RECORDATORIO_CUOTA_CLAVE };
