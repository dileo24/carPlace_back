const { cloudinary } = require("../../../services/cloudinaryService");

// GET /files/:clientId
const getGeneralImage = async (req, res) => {
  try {
    const { clientId } = req.params;

    const resources = await cloudinary.api.resources({
      type: "upload",
      prefix: `general/${clientId}`,
      max_results: 1,
    });

    if (resources.resources.length === 0) {
      return res.status(404).send("Imagen no encontrada");
    }

    res.redirect(resources.resources[0].secure_url);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error al obtener la imagen");
  }
};

module.exports = getGeneralImage;
