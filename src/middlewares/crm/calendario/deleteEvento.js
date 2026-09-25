const { EventoCalendario } = require("../../../db");
const { getIO } = require("../../../bot/socket");

const deleteEvento = async (req, res) => {
  try {
    const { id } = req.params;

    const evento = await EventoCalendario.findByPk(id);

    if (!evento) {
      return res.status(404).json({
        status: 404,
        error: "Evento no encontrado",
      });
    }
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;

    if (rol !== "admin") {
      if (evento.creadoPorId !== userId) {
        return res
          .status(403)
          .json({ status: 403, error: "Solo el creador puede eliminar este evento." });
      }
    }
    await evento.destroy();
    try {
      getIO().emit("calendario:actualizado");
    } catch (_) {}

    res.status(200).json({
      status: 200,
      resp: "Evento eliminado correctamente",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: 500,
      error: error.message,
    });
  }
};

module.exports = deleteEvento;
