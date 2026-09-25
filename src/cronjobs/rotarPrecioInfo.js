const cron = require("node-cron");
const { Auto, conn, Configuracion } = require("../db");
const { Op } = require("sequelize");
const { logCron } = require("../services/cronLog");

// node-cron solo dispara si el proceso está vivo en el minuto exacto programado.
// Si el server estuvo caído/redeployando justo el día 1 a las 00:05, la rotación
// se pierde para siempre (no hay catch-up nativo) — por eso se guarda la marca
// "último mes rotado" en Configuracion y se verifica en cada arranque.
const CLAVE_ULTIMA_ROTACION = "ultima_rotacion_precio_info";

function mesActualKey() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
}

function inicioDeMesActual() {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
}

async function rotarPrecios() {
  console.log("[CRON] Rotando precios info del mes...");
  try {
    // El catch-up de abajo puede disparar días después de empezado el mes —
    // si el admin ya cargó el precio de ESTE mes antes de que corriera (su
    // precio_info_actualizado_en cae dentro del mes en curso), no se toca:
    // es un valor fresco, no una sobra del mes anterior. Sin este chequeo, un
    // catch-up tardío pisa datos recién cargados a mano (bug real detectado
    // el 2026-09-03: precios de septiembre cargados a la mañana, rotados
    // hacia "mes anterior" por un catch-up disparado esa misma tarde).
    const condicion = {
      precio_info_mes_actual: { [Op.not]: null },
      [Op.or]: [
        { precio_info_actualizado_en: null },
        { precio_info_actualizado_en: { [Op.lt]: inicioDeMesActual() } },
      ],
    };

    // Se buscan los ids ANTES de rotar — si algo raro pasa (como el bug de
    // agosto/septiembre 2026, donde nadie sabía qué autos se habían tocado),
    // esto queda en el log para poder reconstruir y corregir sin adivinar.
    const afectados = await Auto.findAll({ where: condicion, attributes: ["id"] });
    const idsAfectados = afectados.map(a => a.id);

    if (idsAfectados.length > 0) {
      await Auto.update(
        {
          precio_info_mes_anterior: conn.col("precio_info_mes_actual"),
          precio_info_mes_actual: null,
        },
        { where: { id: { [Op.in]: idsAfectados } } },
      );
    }

    await Configuracion.upsert({ clave: CLAVE_ULTIMA_ROTACION, valor: mesActualKey() });

    const resumen = `Rotación completada. ${idsAfectados.length} autos actualizados. IDs: [${idsAfectados.join(", ")}]`;
    console.log(`[CRON] ${resumen}`);
    await logCron("rotacion_precio_info", "ok", resumen);
  } catch (err) {
    console.error("[CRON] Error al rotar precios:", err);
    await logCron("rotacion_precio_info", "error", "Error al rotar precios", err.message);
  }
}

// Al arrancar el server, si ya pasamos de mes sin que la rotación se haya
// registrado, la corre ahora mismo. La primera vez que existe este chequeo
// (todavía no hay marca guardada) NO rota de oficio — puede que el mes actual
// ya se haya corregido a mano — solo deja la marca para empezar a trackear
// desde acá en adelante.
async function verificarRotacionPendiente() {
  try {
    const config = await Configuracion.findOne({ where: { clave: CLAVE_ULTIMA_ROTACION } });
    if (!config) {
      await Configuracion.upsert({ clave: CLAVE_ULTIMA_ROTACION, valor: mesActualKey() });
      return;
    }
    if (config.valor === mesActualKey()) return;

    // Reclamo atómico: si dos procesos arrancan casi juntos (ej. un redeploy
    // con solapamiento breve entre la instancia vieja y la nueva), los dos
    // pueden leer "pendiente" al mismo tiempo. Solo el que efectivamente
    // logra cambiar la fila (el UPDATE de abajo afecta 1 fila, condicionado
    // al valor viejo) corre la rotación — el otro la encuentra ya cambiada y
    // no hace nada. Esto se vio pasar en vivo el 2026-09-03 (dos "Rotando
    // precios info del mes..." casi al mismo segundo).
    const [filasAfectadas] = await Configuracion.update(
      { valor: mesActualKey() },
      { where: { clave: CLAVE_ULTIMA_ROTACION, valor: config.valor } },
    );
    if (filasAfectadas === 0) return;

    console.log("[CRON] Rotación de precios pendiente de un mes anterior, ejecutando ahora...");
    await rotarPrecios();
  } catch (err) {
    console.error("[CRON] Error verificando rotación pendiente:", err);
  }
}

// Se ejecuta el día 1 de cada mes a las 00:05
cron.schedule("5 0 1 * *", rotarPrecios, { timezone: "America/Argentina/Cordoba" });

verificarRotacionPendiente();

module.exports = { rotarPrecios, verificarRotacionPendiente };
