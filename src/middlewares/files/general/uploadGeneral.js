const fs = require("fs");
const { processImage, uploadToCloudinary } = require("../../../services/cloudinaryService");

// POST /files
const uploadGeneral = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 400,
        resp: "Archivo requerido",
        details: "Debes enviar el archivo en el campo 'file'",
      });
    }

    const buffer = await fs.promises.readFile(req.file.path);
    await fs.promises.unlink(req.file.path).catch(console.error);

    const webpBuffer = await processImage(buffer);
    const uploadResult = await uploadToCloudinary(webpBuffer);

    const imageId = uploadResult.public_id.split("/").pop();

    res.status(200).json({
      status: 200,
      resp: true,
      fileName: imageId,
      url: uploadResult.secure_url,
      message: "Imagen procesada y subida exitosamente",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      status: 500,
      resp: "Error al procesar imagen",
      error: process.env.NODE_ENV === "development" ? error.message : null,
    });
  }
};

module.exports = uploadGeneral;
