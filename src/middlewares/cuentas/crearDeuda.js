// controllers/cuentas/crearDeuda.js
const { Deuda, Admin } = require("../../db");
const hoyArgentina = require("../../services/hoyArgentina");

// POST /cuentas — carga una nueva deuda entre socios (Admin ↔ Admin).
const crearDeuda = async (req, res) => {
  try {
    const { monto, moneda, motivo, deudorId, acreedorId, fecha } = req.body;

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ status: 400, error: "El monto debe ser mayor a 0" });
    }
    if (!motivo?.trim()) {
      return res.status(400).json({ status: 400, error: "El motivo es requerido" });
    }
    if (!deudorId || !acreedorId) {
      return res.status(400).json({ status: 400, error: "Elegí quién le debe a quién" });
    }
    if (Number(deudorId) === Number(acreedorId)) {
      return res.status(400).json({ status: 400, error: "El deudor y el acreedor no pueden ser el mismo" });
    }

    const [deudor, acreedor] = await Promise.all([
      Admin.findByPk(deudorId),
      Admin.findByPk(acreedorId),
    ]);
    if (!deudor || !acreedor) {
      return res.status(404).json({ status: 404, error: "Admin no encontrado" });
    }

    const deuda = await Deuda.create({
      monto: Math.round(Number(monto)),
      moneda: moneda === "USD" ? "USD" : "ARS",
      motivo: motivo.trim(),
      deudorId,
      acreedorId,
      creadoPorId: req.user?.id ?? null,
      fecha: fecha || hoyArgentina(),
    });

    res.status(201).json({ status: 201, resp: deuda });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = crearDeuda;
