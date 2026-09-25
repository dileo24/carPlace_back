const { AutoTareaAlistaje } = require("../../../db");
const { parsearEnteroLimpio } = require("../../../services/formatearAuto");

const createTareaAlistaje = async (req, res) => {
  try {
    const { id } = req.params;
    const { texto, orden, precio } = req.body;

    if (!texto?.trim()) {
      return res.status(400).json({ status: "400", resp: "El campo texto es requerido." });
    }

    const tarea = await AutoTareaAlistaje.create({
      autoId: id,
      texto: texto.trim(),
      hecha: false,
      orden: orden ?? 0,
      precio: precio !== undefined ? parsearEnteroLimpio(precio) : null,
    });

    return res.status(201).json({ status: 201, resp: tarea });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = createTareaAlistaje;