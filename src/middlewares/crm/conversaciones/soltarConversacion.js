const { Conversacion } = require("../../../db");
const { getIO } = require("../../../bot/socket");

const soltarConversacion = async (req, res) => {
  try {
    const userId = req.user?.id ?? null;

    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    if (conv.estado !== "asesor")
      return res
        .status(400)
        .json({ status: 400, error: "Solo se puede soltar una conversación en estado 'asesor'" });

    if (!conv.asesorId)
      return res.status(400).json({ status: 400, error: "La conversación ya está libre" });

    // Solo quien la tiene tomada puede soltarla — sin excepción de rol
    if (String(conv.asesorId) !== String(userId))
      return res
        .status(403)
        .json({ status: 403, error: "No podés soltar una conversación que no tomaste vos" });

    await conv.update({
      asesorId: null,
      asesorNombre: null,
      asesorApellido: null,
    });

    try {
      getIO().emit("conversacion:soltada", { conversacionId: conv.id });
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: conv });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = soltarConversacion;
