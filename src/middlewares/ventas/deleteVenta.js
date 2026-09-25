const { Venta } = require("../../db");

const ROLES_SIN_ACCESO = ["supervisor"]; // ideal: constants.js compartido

const deleteVenta = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (ROLES_SIN_ACCESO.includes(rol)) {
      return res
        .status(403)
        .json({ status: "403", resp: "No tenés permiso para eliminar ventas." });
    }

    const { id } = req.params;
    const venta = await Venta.findByPk(id);
    if (!venta) return res.status(404).json({ status: "404", resp: `Venta ${id} no encontrada.` });

    await venta.destroy();
    return res.status(200).json({ status: 200, resp: `Venta ${id} eliminada correctamente.` });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = deleteVenta;
