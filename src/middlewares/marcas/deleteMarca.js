const { Marca } = require("../../db");
const { deleteFromCloudinary } = require("../../services/cloudinaryService");

// DELETE /marcas/:id — borra solo la marca (y su foto de Cloudinary si tiene).
// No toca los autos que la tenían asignada: el frontend ya le mostró al admin
// una advertencia con el listado de autos afectados antes de llegar acá.
const deleteMarca = async (req, res) => {
  try {
    const marca = await Marca.findByPk(req.params.id);
    if (!marca) return res.status(404).json({ status: 404, error: "Marca no encontrada" });

    if (marca.fotoPublicId) {
      const publicId = `general/${marca.fotoPublicId}`;
      const { success, error } = await deleteFromCloudinary(publicId);
      if (!success) {
        console.error(`No se pudo borrar de Cloudinary la foto de marca ${publicId}:`, error);
      }
    }

    await marca.destroy();

    res.status(200).json({ status: 200, resp: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = deleteMarca;
