const { Op } = require("sequelize");
const { Conversacion, Mensaje, ConsultaHistorial } = require("../../../db");
const { getIO } = require("../../../bot/socket");
const { deleteFromCloudinary, publicIdFromCloudinaryUrl } = require("../../../services/cloudinaryService");

const eliminarConversacion = async (req, res) => {
  try {
    const rol = req.user?.rol || "";

    if (!["admin", "supervisor"].includes(rol)) {
      return res.status(403).json({ status: 403, error: "Sin permiso para esta acción" });
    }

    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ status: 404, error: "Conversación no encontrada" });

    // Los audios/fotos/videos de los mensajes viven en Cloudinary, no en la
    // BD. Guardamos los datos ANTES de borrar nada, pero el borrado en
    // Cloudinary se hace DESPUÉS de borrar los mensajes/la conversación en la
    // base (nunca antes) — mismo criterio que useAutoDetail.js para las fotos
    // de autos: si el borrado en Cloudinary fallara a mitad de camino, es
    // preferible un archivo huérfano en Cloudinary (inofensivo) a que quede
    // un mensaje en la base apuntando a un archivo que ya no existe.
    const mensajesConMedia = await Mensaje.findAll({
      where: { conversacionId: conv.id, mediaUrl: { [Op.ne]: null } },
    });
    const mediaABorrar = mensajesConMedia.map(mensaje => ({
      mensajeId: mensaje.id,
      datos: mensaje.mediaPublicId
        ? { publicId: mensaje.mediaPublicId, resourceType: mensaje.mediaResourceType || "image" }
        : publicIdFromCloudinaryUrl(mensaje.mediaUrl),
    }));

    await Mensaje.destroy({ where: { conversacionId: conv.id } });
    // Las notas del historial pueden quedar vinculadas a la consulta (si la
    // hay) aunque la conversación desaparezca — solo soltamos la referencia
    // a la conversación borrada, no la nota en sí.
    await ConsultaHistorial.update({ conversacionId: null }, { where: { conversacionId: conv.id } });
    await conv.destroy();

    await Promise.all(
      mediaABorrar.map(async ({ mensajeId, datos }) => {
        if (!datos) {
          console.warn(`No se pudo determinar public_id para el mensaje ${mensajeId}, se omite`);
          return;
        }

        const { success, error } = await deleteFromCloudinary(datos.publicId, datos.resourceType);
        if (!success) {
          console.error(`No se pudo borrar de Cloudinary el media del mensaje ${mensajeId}:`, error);
        }
      }),
    );

    try {
      getIO().emit("conversacion:eliminada", { conversacionId: conv.id });
    } catch (_) {}

    return res.status(200).json({ status: 200, resp: { eliminada: conv.id } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 500, error: err.message });
  }
};

module.exports = eliminarConversacion;