const { Mensaje } = require("../../../db");
const { getIO } = require("../../../bot/socket");

// Solo admin puede ocultar/mostrar mensajes manualmente — es una acción
// sensible (afecta qué ve el vendedor) y no algo que un vendedor deba poder
// hacerse a sí mismo.
const ROLES_CON_ACCESO = ["admin"];

const toggleOcultoMensaje = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (!ROLES_CON_ACCESO.includes(rol)) {
      return res.status(403).json({ status: 403, error: "Sin permiso para esta acción" });
    }

    const { id: conversacionId, mensajeId } = req.params;
    const mensaje = await Mensaje.findOne({ where: { id: mensajeId, conversacionId } });
    if (!mensaje) return res.status(404).json({ status: 404, error: "Mensaje no encontrado" });

    const nuevoValor = !mensaje.ocultoManual;
    await mensaje.update({ ocultoManual: nuevoValor });

    const quien = [req.user?.nombre, req.user?.apellido].filter(Boolean).join(" ") || `userId ${req.user?.id}`;
    console.log(
      `${nuevoValor ? "🙈 Ocultado" : "👁️ Mostrado"} mensaje ${mensaje.id} (conv ${conversacionId}) por ${quien}`,
    );

    try {
      if (nuevoValor) {
        getIO().emit("conversacion:mensajeEliminado", {
          conversacionId: Number(conversacionId),
          mensajeId: mensaje.id,
          campo: "ocultoManual",
        });
      } else {
        getIO().emit("conversacion:mensajeRestaurado", { conversacionId: Number(conversacionId), mensaje: mensaje.toJSON() });
      }
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: mensaje });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = toggleOcultoMensaje;
