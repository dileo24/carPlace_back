// controllers/gastos/eliminarGasto.js
const { Gasto } = require("../../db");

const eliminarGasto = async (req, res) => {
  try {
    const gasto = await Gasto.findByPk(req.params.id);
    if (!gasto) return res.status(404).json({ status: 404, error: "Gasto no encontrado" });

    await gasto.destroy();

    res.status(200).json({ status: 200, resp: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = eliminarGasto;
