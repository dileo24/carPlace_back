// middlewares/crm/consultas/deleteConsulta.js
const { Consulta, ConsultaHistorial, Conversacion, EventoCalendario } = require("../../../db");

// Solo admin puede eliminar manualmente
const deleteConsulta = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (rol !== "admin") {
      return res.status(403).json({ status: 403, error: "Sin permiso para esta acción" });
    }

    const { id } = req.params;

    const consulta = await Consulta.findByPk(id);
    if (!consulta) {
      return res.status(404).json({ status: 404, error: "Consulta no encontrada" });
    }

    // Antes de borrar, desvinculamos todo lo que le apuntaba — si no, la
    // conversación y los eventos quedan con un consultaId huérfano y sus
    // botones "Ver consulta completa" no llevan a ningún lado.
    const conversacionesAfectadas = await Conversacion.findAll({
      where: { consultaId: id },
      attributes: ["id"],
    });

    await ConsultaHistorial.destroy({ where: { consultaId: id } });
    await Conversacion.update({ consultaId: null }, { where: { consultaId: id } });
    await EventoCalendario.update({ consultaId: null }, { where: { consultaId: id } });
    await consulta.destroy();

    try {
      const { getIO } = require("../../../bot/socket");
      const io = getIO();
      conversacionesAfectadas.forEach(c =>
        io.emit("conversacion:actualizada", { conversacionId: c.id, consultaId: null }),
      );
      io.emit("calendario:actualizado");
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: "Consulta eliminada correctamente" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = deleteConsulta;