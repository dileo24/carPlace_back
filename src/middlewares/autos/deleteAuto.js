const { Auto } = require("../../db");
const { deleteFromCloudinary, publicIdFromCloudinaryUrl } = require("../../services/cloudinaryService");
const { eliminarPublicacionesDeAuto } = require("../../services/mercadolibreListingsService");

const deleteAuto = async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);

    if (!numericId || isNaN(numericId)) {
      return res.status(400).json({
        status: "400",
        resp: "El ID debe ser un número válido.",
      });
    }

    const auto = await Auto.findByPk(numericId);
    if (!auto) {
      return res.status(404).json({
        status: "404",
        resp: "Auto no encontrado.",
      });
    }

    // Si el auto tiene una publicación activa/pausada en MercadoLibre, se
    // elimina también allá antes de borrarlo. Si alguna falla, la fila de
    // Publicacion sobrevive igual (autoId queda en null) y se avisa acá abajo
    // — antes esto fallaba en silencio y la publicación quedaba huérfana y
    // viva en ML sin ningún rastro en el CRM.
    const publicacionesFallidas = await eliminarPublicacionesDeAuto(numericId);

    if (auto.img && Array.isArray(auto.img)) {
      await Promise.all(
        auto.img.map(async url => {
          const datos = publicIdFromCloudinaryUrl(url);
          if (!datos) {
            console.warn(`No se pudo determinar public_id para la foto: ${url}`);
            return;
          }

          const { success, error } = await deleteFromCloudinary(datos.publicId, datos.resourceType);
          if (!success) {
            console.error(`No se pudo borrar de Cloudinary la imagen ${datos.publicId}:`, error);
          }
        }),
      );
    }

    await auto.destroy();

    const advertencia = publicacionesFallidas.length
      ? `${publicacionesFallidas.length === 1 ? "1 publicación" : `${publicacionesFallidas.length} publicaciones`} de MercadoLibre no se pudo eliminar y sigue activa allá — revisala desde el módulo de Publicaciones.`
      : null;

    return res.status(200).json({
      status: "200",
      resp: `Auto con ID ${numericId} y sus imágenes eliminados correctamente.`,
      advertencia,
    });
  } catch (err) {
    console.error("Error en deleteAuto:", err);
    return res.status(500).json({
      status: "500",
      resp: "Error interno del servidor",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

module.exports = deleteAuto;
