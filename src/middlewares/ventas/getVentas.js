const { Venta } = require("../../db");
const { Op } = require("sequelize");

const getVentas = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const where = {};
    // El socio solo ve las ventas de sus autos (propios o compartidos); el
    // resto del equipo (supervisor, etc., salvo admin) nunca ve esas ventas.
    if (rol === "socio") {
      where.propietarioAuto = { [Op.in]: ["socio", "compartido"] };
    } else if (rol !== "admin") {
      where.propietarioAuto = "agencia";
    }

    const ventas = await Venta.findAll({
      where,
      order: [["fechaVenta", "DESC"]],
    });
    return res.status(200).json({ status: 200, resp: ventas });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = getVentas;