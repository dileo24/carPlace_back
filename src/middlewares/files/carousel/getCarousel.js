const { cloudinary } = require("../../../services/cloudinaryService");

// GET /files/carousel
const getCarousel = async (req, res) => {
  try {
    const result = await cloudinary.api.resources({
      type: "upload",
      prefix: "carousel/",
      max_results: 20,
      context: true,
    });

    const files = result.resources
      .map(file => ({
        fileName: file.public_id.split("/").pop(),
        url: file.secure_url,
        order:
          file.context?.custom?.order !== undefined ? parseInt(file.context.custom.order) : 999,
      }))
      .sort((a, b) => a.order - b.order); // 👈 ordenar por metadato

    res.status(200).json({ status: 200, resp: true, files, count: files.length });
  } catch (error) {
    res.status(500).json({ status: 500, resp: "Error al obtener imágenes" });
  }
};

module.exports = getCarousel;
