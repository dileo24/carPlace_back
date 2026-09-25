const { cloudinary } = require("../../../services/cloudinaryService");

// GET /files/carousel/:id
const getCarouselImage = async (req, res) => {
  try {
    const { id } = req.params;
    const resource = await cloudinary.api.resource(`carousel/${id}`).catch(error => {
      console.error("Error al verificar imagen:", error);
      throw new Error("Imagen no encontrada");
    });

    const imageUrl = cloudinary.url(resource.public_id, {
      secure: true,
      fetch_format: "auto",
      quality: "auto",
      ...(req.query.width && { width: parseInt(req.query.width) }),
      ...(req.query.height && { height: parseInt(req.query.height) }),
      ...(req.query.crop && { crop: req.query.crop }),
    });

    res.redirect(302, imageUrl);
  } catch (error) {
    console.error("Error completo:", {
      error: error.message,
      id: req.params.id,
      timestamp: new Date().toISOString(),
    });

    res.status(error.message === "Imagen no encontrada" ? 404 : 500).json({
      status: error.message === "Imagen no encontrada" ? 404 : 500,
      resp: false,
      error: error.message,
      details:
        process.env.NODE_ENV === "development"
          ? {
              endpoint: `/files/carousel/${req.params.id}`,
              stack: error.stack,
            }
          : undefined,
    });
  }
};

module.exports = getCarouselImage;
