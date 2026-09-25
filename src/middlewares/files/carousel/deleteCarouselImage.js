const { cloudinary } = require("../../../services/cloudinaryService");

// DELETE /files/carousel/:id
const deleteCarouselImage = async (req, res) => {
  try {
    const { id } = req.params;
    const publicId = `carousel/${id}`;

    try {
      await cloudinary.api.resource(publicId);
    } catch (error) {
      console.error("Error al verificar imagen:", {
        publicId,
        error: error.message,
      });
      return res.status(404).json({
        status: 404,
        resp: "Imagen no encontrada en Cloudinary",
        details: {
          id,
          publicId,
          suggestion: "Verifique que la imagen exista en el carrusel",
        },
      });
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      type: "upload",
      invalidate: true,
    });

    if (result.result !== "ok") {
      return res.status(500).json({
        status: 500,
        resp: "Error al eliminar la imagen",
        details: {
          apiResponse: result,
          nextSteps: [
            "Verificar permisos de la API Key",
            "Revisar políticas de retención en Cloudinary",
          ],
        },
      });
    }

    try {
      await cloudinary.api.resource(publicId);
      return res.status(500).json({
        status: 500,
        resp: "La imagen no fue eliminada completamente",
        details: {
          apiResponse: result,
          warning: "La imagen sigue existiendo después de eliminación",
        },
      });
    } catch (verifyError) {
      return res.status(200).json({
        status: 200,
        resp: true,
        id,
        publicId,
        details: {
          deletedAt: new Date().toISOString(),
          apiResponse: result,
        },
        message: "Imagen eliminada exitosamente",
      });
    }
  } catch (error) {
    console.error("Error completo:", {
      error: error.stack,
      params: req.params,
    });

    res.status(500).json({
      status: 500,
      resp: "Error en el proceso de eliminación",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              stack: error.stack,
              publicId: `carousel/${req.params.id}`,
            }
          : null,
    });
  }
};

module.exports = deleteCarouselImage;
