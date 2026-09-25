const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const processImage = async (buffer, targetWidth = 1200) => {
  const pipeline = sharp(buffer).rotate();

  const metadata = await pipeline.metadata();

  if (metadata.width > targetWidth) {
    pipeline.resize({
      width: targetWidth,
      height: Math.round(targetWidth * (metadata.height / metadata.width)),
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  return pipeline
    .webp({ quality: 80, alphaQuality: 80, lossless: false, smartSubsample: true, effort: 3 })
    .toBuffer();
};

const uploadToCloudinary = (buffer, folder = "general") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        format: "webp",
        quality: "auto:good",
        fetch_format: "auto",
        transformation: [{ width: 1200, crop: "limit" }, { quality: "auto:good" }],
      },
      (error, result) => {
        if (error) return reject(error);
        const id = result.public_id.split("/").pop();
        resolve({
          ...result,
          id,
          folder,
        });
      },
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: resourceType,
    });

    return {
      success: result.result === "ok",
      details: result,
    };
  } catch (error) {
    console.error("Error detallado al eliminar:", {
      message: error.message,
      publicId,
      resourceType,
      stack: error.stack,
    });
    return {
      success: false,
      error,
    };
  }
};

// Para audio/video (notas de voz, videos del CRM/WhatsApp) — sin las
// transformaciones de imagen (webp/resize) que aplica uploadToCloudinary.
const uploadMediaToCloudinary = (buffer, folder = "general", resourceType = "image") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Fallback para archivos subidos antes de que se empezara a guardar el
// public_id: reconstruye {resourceType, publicId} a partir de la URL de
// Cloudinary (formato .../<resourceType>/upload/v<version>/<publicId>.<ext>).
const publicIdFromCloudinaryUrl = url => {
  if (!url) return null;
  const match = url.match(/\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  const [, resourceType, rest] = match;
  return { resourceType, publicId: rest.replace(/\.[a-zA-Z0-9]+$/, "") };
};

module.exports = {
  cloudinary,
  processImage,
  uploadToCloudinary,
  uploadMediaToCloudinary,
  deleteFromCloudinary,
  publicIdFromCloudinaryUrl,
};
