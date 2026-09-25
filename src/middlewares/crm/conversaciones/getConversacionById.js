const { Conversacion, Mensaje } = require("../../../db");

const ROLES_FULL = ["admin", "supervisor"];
const ROLES_VENDEDOR = ["vendedor", "publicador_vendedor"];

const getConversacionById = async (req, res) => {
  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Mensaje, as: "mensajes", separate: true, order: [["timestamp", "ASC"]] }],
    });
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    const rol = req.user?.rol || "";
    const userId = req.user?.id ?? null;
    const esAdmin = ROLES_FULL.includes(rol);

    // Vendedores solo pueden ver: sin tomar (de cualquiera) o asignadas a ellos
    // — mismo criterio que la lista (getConversaciones.js).
    if (ROLES_VENDEDOR.includes(rol)) {
      const esLibre = conv.estado === "bot" || (conv.estado === "asesor" && conv.asesorId === null);
      const esPropia = conv.asesorId === userId;
      if (!esLibre && !esPropia) {
        return res.status(403).json({ status: 403, error: "Sin permiso para esta conversación" });
      }
    }

    const obj = conv.toJSON();

    if (!esAdmin) {
      const todos = obj.mensajes || [];
      const visibles = todos.filter(m => !m.esSeguimiento7Dias && !m.ocultoManual);
      if (visibles.length !== todos.length) {
        obj.ultimoMensaje = visibles.length ? visibles[visibles.length - 1].texto : null;
        obj.ultimaActividad = visibles.length ? visibles[visibles.length - 1].timestamp : obj.createdAt;
      }
      obj.mensajes = visibles;
    }

    return res.status(200).json({ status: 200, resp: obj });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = getConversacionById;