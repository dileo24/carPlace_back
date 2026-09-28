// controllers/gastos/crearGasto.js
const { Gasto } = require("../../db");
const hoyArgentina = require("../../services/hoyArgentina");

const crearGasto = async (req, res) => {
  try {
    const { monto, moneda, categoria, descripcion, fecha } = req.body;

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ status: 400, error: "El monto debe ser mayor a 0" });
    }
    if (!categoria?.trim()) {
      return res.status(400).json({ status: 400, error: "La categoría es requerida" });
    }

    const gasto = await Gasto.create({
      monto: Math.round(Number(monto)),
      moneda: moneda === "USD" ? "USD" : "ARS",
      categoria: categoria.trim(),
      descripcion: descripcion?.trim() || null,
      fecha: fecha || hoyArgentina(),
      creadoPorId: req.user?.id ?? null,
    });

    res.status(201).json({ status: 201, resp: gasto });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = crearGasto;
