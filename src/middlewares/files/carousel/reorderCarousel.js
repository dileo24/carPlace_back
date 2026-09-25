const { cloudinary } = require("../../../services/cloudinaryService");

// PATCH /files/carousel/reorder
const reorderCarousel = async (req, res) => {
  try {
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ status: 400, resp: "Order array requerido" });
    }

    const updates = order.map((id, index) =>
      cloudinary.uploader.explicit(`carousel/${id}`, {
        type: "upload",
        context: `order=${index}`,
      }),
    );

    await Promise.all(updates);

    res.status(200).json({ status: 200, resp: true, message: "Orden actualizado exitosamente" });
  } catch (error) {
    console.error("Error al reordenar:", error);
    res.status(500).json({ status: 500, resp: "Error al guardar el orden" });
  }
};

module.exports = reorderCarousel;
