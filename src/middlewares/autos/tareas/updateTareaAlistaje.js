const { AutoTareaAlistaje } = require("../../../db");
const { parsearEnteroLimpio } = require("../../../services/formatearAuto");

const updateTareaAlistaje = async (req, res) => {
  try {
    const { id, tareaId } = req.params;
    const { texto, hecha, orden, precio } = req.body;

    const tarea = await AutoTareaAlistaje.findOne({
      where: { id: tareaId, autoId: id },
    });

    if (!tarea) {
      return res.status(404).json({ status: "404", resp: `Tarea ${tareaId} no encontrada para el auto ${id}.` });
    }

    await tarea.update({
      ...(texto !== undefined && { texto: texto.trim() }),
      ...(hecha !== undefined && { hecha }),
      ...(orden !== undefined && { orden }),
      ...(precio !== undefined && { precio: parsearEnteroLimpio(precio) }),
    });

    return res.status(200).json({ status: 200, resp: tarea });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = updateTareaAlistaje;