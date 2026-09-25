const { deleteFromCloudinary } = require("../../../services/cloudinaryService");

// DELETE /files/:id
const deleteGeneralImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: 400,
        resp: "ID de imagen requerido",
      });
    }

    const cleanId = id.replace(/\.[a-zA-Z0-9]+$/, "");
    const publicId = `general/${cleanId}`;
    const { success, details, error } = await deleteFromCloudinary(publicId);

    if (!success) {
      console.error("Fallo al eliminar:", {
        publicId,
        error: details || error,
      });

      return res.status(404).json({
        status: 404,
        resp: "Imagen no encontrada en Cloudinary",
        details: {
          id,
          publicId,
          apiResponse: details,
          error: process.env.NODE_ENV === "development" ? error : undefined,
        },
      });
    }

    res.status(200).json({
      status: 200,
      resp: true,
      id: id,
      publicId: publicId,
      apiResponse: details,
      message: "Imagen eliminada exitosamente",
    });
  } catch (error) {
    console.error("Error completo al eliminar imagen:", {
      error: error.stack,
      params: req.params,
    });

    res.status(500).json({
      status: 500,
      resp: "Error al eliminar la imagen",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              stack: error.stack,
            }
          : null,
    });
  }
};

module.exports = deleteGeneralImage;
