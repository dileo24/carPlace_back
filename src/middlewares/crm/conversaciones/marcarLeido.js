const { Conversacion } = require("../../../db");
const { getIO } = require("../../../bot/socket");

const marcarLeido = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    const updateData = { noLeido: 0 };
    if (rol === "admin") updateData.adminNoLeido = false;

    await conv.update(updateData);
    try {
      getIO().emit("conversacion:leida", {
        conversacionId: conv.id,
        adminNoLeido: conv.adminNoLeido,
      });
    } catch (_) {}
    return res.status(200).json({ status: 200, resp: { id: conv.id, noLeido: 0 } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = marcarLeido;
