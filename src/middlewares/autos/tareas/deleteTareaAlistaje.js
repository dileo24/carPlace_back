const { AutoTareaAlistaje } = require("../../../db");

const deleteTareaAlistaje = async (req, res) => {
  try {
    const { id, tareaId } = req.params;

    const tarea = await AutoTareaAlistaje.findOne({
      where: { id: tareaId, autoId: id },
    });

    if (!tarea) {
      return res.status(404).json({ status: "404", resp: `Tarea ${tareaId} no encontrada para el auto ${id}.` });
    }

    await tarea.destroy();

    return res.status(200).json({ status: 200, resp: `Tarea ${tareaId} eliminada correctamente.` });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = deleteTareaAlistaje;