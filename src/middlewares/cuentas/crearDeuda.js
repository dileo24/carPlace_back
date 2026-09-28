// controllers/cuentas/crearDeuda.js
const { Deuda, User } = require("../../db");
const hoyArgentina = require("../../services/hoyArgentina");

// POST /cuentas — carga una nueva deuda. Cada punta (deudor/acreedor) puede
// ser un usuario del sistema (deudorId/acreedorId) o un tercero ajeno
// ("Otro"), identificado solo por nombre y teléfono.
const crearDeuda = async (req, res) => {
  try {
    const { monto, moneda, motivo, deudorId, deudorNombre, deudorTelefono, acreedorId, acreedorNombre, acreedorTelefono, fecha } =
      req.body;

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ status: 400, error: "El monto debe ser mayor a 0" });
    }
    if (!motivo?.trim()) {
      return res.status(400).json({ status: 400, error: "El motivo es requerido" });
    }

    const esOtroDeudor = !deudorId;
    const esOtroAcreedor = !acreedorId;

    if (esOtroDeudor && (!deudorNombre?.trim() || !deudorTelefono?.trim())) {
      return res.status(400).json({ status: 400, error: "Completá nombre y teléfono de quién debe" });
    }
    if (esOtroAcreedor && (!acreedorNombre?.trim() || !acreedorTelefono?.trim())) {
      return res.status(400).json({ status: 400, error: "Completá nombre y teléfono de a quién le debe" });
    }
    if (!esOtroDeudor && !esOtroAcreedor && Number(deudorId) === Number(acreedorId)) {
      return res.status(400).json({ status: 400, error: "El deudor y el acreedor no pueden ser el mismo" });
    }

    if (!esOtroDeudor && !(await User.findByPk(deudorId))) {
      return res.status(404).json({ status: 404, error: "Usuario no encontrado (deudor)" });
    }
    if (!esOtroAcreedor && !(await User.findByPk(acreedorId))) {
      return res.status(404).json({ status: 404, error: "Usuario no encontrado (acreedor)" });
    }

    const deuda = await Deuda.create({
      monto: Math.round(Number(monto)),
      moneda: moneda === "USD" ? "USD" : "ARS",
      motivo: motivo.trim(),
      deudorId: esOtroDeudor ? null : Number(deudorId),
      deudorNombre: esOtroDeudor ? deudorNombre.trim() : null,
      deudorTelefono: esOtroDeudor ? deudorTelefono.trim() : null,
      acreedorId: esOtroAcreedor ? null : Number(acreedorId),
      acreedorNombre: esOtroAcreedor ? acreedorNombre.trim() : null,
      acreedorTelefono: esOtroAcreedor ? acreedorTelefono.trim() : null,
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
