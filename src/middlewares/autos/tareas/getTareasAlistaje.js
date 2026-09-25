const { AutoTareaAlistaje } = require("../../../db");

const getTareasAlistaje = async (req, res) => {
  try {
    const { id } = req.params;

    const tareas = await AutoTareaAlistaje.findAll({
      where: { autoId: id },
      order: [["orden", "ASC"], ["id", "ASC"]],
    });

    return res.status(200).json({ status: 200, resp: tareas });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = getTareasAlistaje;