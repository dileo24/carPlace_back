const { Conversacion } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { limpiarSeguimiento7Dias } = require("../../../services/limpiarSeguimiento7Dias");
const { limpiarEsperandoConfirmacionVisita } = require("../../../services/limpiarEsperandoConfirmacionVisita");

const ROLES_FULL_TOMAR = ["admin"]; // solo admin puede forzar la toma de una conversación ajena

const tomarConversacion = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const userName = req.user?.nombre || "";
    const userApellido = req.user?.apellido || "";

    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    if (conv.estado === "cerrada")
      return res.status(400).json({ status: 400, error: "La conversación está cerrada" });

    const puedeForzar = ROLES_FULL_TOMAR.includes(rol);

    // Si ya la tomó otro asesor, rechazar — salvo admin, que puede forzar la toma
    if (conv.asesorId && String(conv.asesorId) !== String(userId) && !puedeForzar)
      return res
        .status(409)
        .json({ status: 409, error: "Ya está siendo atendida por otro asesor" });

    // Si ya la tomó él mismo, devolver sin error
    if (String(conv.asesorId) === String(userId))
      return res.status(200).json({ status: 200, resp: conv });

    // Update atómico condicionado a que siga libre (salvo que pueda forzar) —
    // sin esto, dos asesores que tocan "tomar" casi al mismo tiempo pasan
    // ambos la validación de arriba antes de que el otro escriba, y solo
    // queda asignado el que actualizó último aunque los dos vean éxito.
    const condicionLibre = puedeForzar ? { id: conv.id } : { id: conv.id, asesorId: null };
    const [afectados] = await Conversacion.update(
      {
        asesorId: userId,
        asesorNombre: userName || null,
        asesorApellido: userApellido || null,
        estado: "asesor",
      },
      { where: condicionLibre },
    );

    if (afectados === 0) {
      return res.status(409).json({ status: 409, error: "Ya está siendo atendida por otro asesor" });
    }

    const actualizada = await Conversacion.findByPk(conv.id);

    try {
      await limpiarSeguimiento7Dias(conv.id);
    } catch (_) {}

    try {
      await limpiarEsperandoConfirmacionVisita(conv.id);
    } catch (_) {}

    try {
      getIO().emit("conversacion:estadoCambiado", {
        conversacionId: conv.id,
        estado: "asesor",
        asesorNombre: userName || null,
        asesorApellido: userApellido || null,
      });
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: actualizada });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = tomarConversacion;
