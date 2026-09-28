// controllers/gastos/listarGastos.js
const { Gasto } = require("../../db");

const listarGastos = async (req, res) => {
  try {
    const gastos = await Gasto.findAll({ order: [["fecha", "DESC"], ["id", "DESC"]] });
    res.status(200).json({ status: 200, resp: gastos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = listarGastos;
