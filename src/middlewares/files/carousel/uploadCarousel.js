const fs = require("fs");
const { cloudinary, processImage, uploadToCloudinary } = require("../../../services/cloudinaryService");

// POST /files/carousel
const uploadCarousel = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ status: 400, resp: "Archivos requeridos" });
    }

    const currentResources = await cloudinary.api.resources({
      type: "upload",
      prefix: "carousel/",
      max_results: 20,
    });

    const remainingSlots = Math.max(0, 20 - currentResources.resources.length);

    if (remainingSlots === 0) {
      return res.status(400).json({
        status: 400,
        resp: "Límite del carrusel alcanzado (20 imágenes máx.)",
      });
    }

    const filesToProcess = req.files.slice(0, remainingSlots);
    const results = [];

    for (const file of filesToProcess) {
      try {
        const buffer = await fs.promises.readFile(file.path);
        await fs.promises.unlink(file.path).catch(console.error);

        const webpBuffer = await processImage(buffer);
        const uploadResult = await uploadToCloudinary(webpBuffer, "carousel");

        results.push({
          fileName: uploadResult.id, // Solo el ID
          url: uploadResult.secure_url,
        });
      } catch (error) {
        console.error(`Error procesando ${file.originalname}:`, error);
      }
    }

    if (results.length === 0) {
      return res.status(500).json({
        status: 500,
        resp: "Error al procesar las imágenes",
      });
    }

    res.status(200).json({
      status: 200,
      resp: true,
      files: results,
      message: `Imágenes agregadas al carrusel (${results.length}/${remainingSlots})`,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      status: 500,
      resp: "Error al procesar imágenes del carrusel",
      error: process.env.NODE_ENV === "development" ? error.message : null,
    });
  }
};

module.exports = uploadCarousel;
