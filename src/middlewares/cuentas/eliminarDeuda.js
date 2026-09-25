// controllers/cuentas/eliminarDeuda.js
const { Deuda } = require("../../db");

// DELETE /cuentas/:id — borra un registro (carga por error, o deuda ya saldada
// en efectivo/transferencia fuera del sistema).
const eliminarDeuda = async (req, res) => {
  try {
    const deuda = await Deuda.findByPk(req.params.id);
    if (!deuda) return res.status(404).json({ status: 404, error: "Registro no encontrado" });

    await deuda.destroy();

    res.status(200).json({ status: 200, resp: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = eliminarDeuda;
