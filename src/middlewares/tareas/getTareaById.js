// controllers/tareas/getTareaById.js
const { Tarea } = require("../../db");

const getTareaById = async (req, res) => {
  try {
    const { id } = req.params;

    const tarea = await Tarea.findByPk(id);
    if (!tarea) {
      return res.status(404).json({ error: `Tarea con id ${id} no encontrada.` });
    }

    const userId = req.user?.id ?? null;
    const rol = req.user?.rol || "";
    if (
      ["admin", "supervisor", "socio"].includes(rol) &&
      tarea.creadoPorId &&
      tarea.creadoPorId !== userId
    ) {
      return res.status(404).json({ error: `Tarea con id ${id} no encontrada.` });
    }

    res.status(200).json({ status: 200, resp: tarea });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = getTareaById;