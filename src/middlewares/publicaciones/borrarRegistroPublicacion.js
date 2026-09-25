const { Publicacion } = require("../../db");

// DELETE /publicaciones/:id — borra el REGISTRO en nuestra base, no toca
// MercadoLibre (eso ya lo hizo "eliminar", ver cambiarEstadoPublicacion.js).
// Solo tiene sentido una vez que la publicación ya está "eliminada" del todo
// en ML — si todavía está publicada/pausada/cerrada, borrar el registro acá
// dejaría una publicación real en ML sin ninguna fila para poder gestionarla.
const borrarRegistroPublicacion = async (req, res) => {
  try {
    const publicacion = await Publicacion.findByPk(req.params.id);
    if (!publicacion) {
      return res.status(404).json({ status: 404, error: "Publicación no encontrada" });
    }

    if (publicacion.estado !== "eliminada") {
      return res.status(400).json({
        status: 400,
        error: "Solo se puede borrar el registro de una publicación ya eliminada de MercadoLibre.",
      });
    }

    await publicacion.destroy();

    res.status(200).json({ status: 200, resp: { borrada: Number(req.params.id) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = borrarRegistroPublicacion;
