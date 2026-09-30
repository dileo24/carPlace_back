// controllers/cuentas/saldarDeuda.js
const { Deuda } = require("../../db");
const hoyArgentina = require("../../services/hoyArgentina");
const { formatoMonto, pendienteDe, nombreDePunta, mapaNombresAdmins, notificarMovimiento } = require("../../services/cuentasHelper");

// PATCH /cuentas/:id/saldar — registra un pago de la deuda. Hay que indicar
// cómo se pagó (metodo) o dejar un comentario. Las deudas internas admiten un
// monto parcial (tope: lo que falta pagar); las de empresa y los préstamos se
// saldan de una sola vez por el total pendiente. La deuda no se borra: una vez
// saldada queda en el listado, tachada.
const saldarDeuda = async (req, res) => {
  try {
    const deuda = await Deuda.findByPk(req.params.id);
    if (!deuda) return res.status(404).json({ status: 404, error: "Registro no encontrado" });
    if (deuda.saldada) return res.status(409).json({ status: 409, error: "Esta deuda ya está saldada" });

    const metodo = req.body.metodo?.trim() || null;
    const comentario = req.body.comentario?.trim() || null;
    if (!metodo && !comentario) {
      return res.status(400).json({ status: 400, error: "Indicá cómo se pagó o dejá un comentario" });
    }

    const pendiente = pendienteDe(deuda);
    let monto = pendiente;
    const pidioMonto = req.body.monto !== undefined && req.body.monto !== null && req.body.monto !== "";
    if (deuda.tipo === "interna" && pidioMonto) {
      monto = Math.round(Number(req.body.monto));
      if (!Number.isFinite(monto) || monto <= 0) {
        return res.status(400).json({ status: 400, error: "El monto a saldar debe ser mayor a 0" });
      }
      if (monto > pendiente) {
        return res.status(400).json({
          status: 400,
          error: `El monto no puede superar lo adeudado (${deuda.moneda} ${formatoMonto(pendiente)})`,
        });
      }
    }

    const hoy = hoyArgentina();
    const montoSaldado = (deuda.montoSaldado || 0) + monto;
    const saldada = montoSaldado >= deuda.monto;
    const pagos = [...(Array.isArray(deuda.pagos) ? deuda.pagos : []), { fecha: hoy, monto, metodo, comentario, porId: req.user?.id ?? null }];

    await deuda.update({ montoSaldado, saldada, saldadaEn: saldada ? hoy : null, pagos });

    const { nombrePorId } = await mapaNombresAdmins();
    const deudorTxt = nombreDePunta(deuda.deudorEmpresa, deuda.deudorId, deuda.deudorNombre, nombrePorId);
    const acreedorTxt = nombreDePunta(deuda.acreedorEmpresa, deuda.acreedorId, deuda.acreedorNombre, nombrePorId);
    const detalle = [metodo && `Forma de pago: ${metodo}`, comentario && `Comentario: ${comentario}`].filter(Boolean).join(" · ");
    notificarMovimiento(
      saldada
        ? `✅ Deuda saldada\n${deudorTxt} → ${acreedorTxt}: ${deuda.moneda} ${formatoMonto(monto)}${monto < deuda.monto ? ` (completa el total de ${deuda.moneda} ${formatoMonto(deuda.monto)})` : ""}\n${detalle}`
        : `🟡 Pago parcial de deuda\n${deudorTxt} → ${acreedorTxt}: ${deuda.moneda} ${formatoMonto(monto)}. Resta ${deuda.moneda} ${formatoMonto(deuda.monto - montoSaldado)}\n${detalle}`,
    );

    res.status(200).json({ status: 200, resp: deuda });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = saldarDeuda;
