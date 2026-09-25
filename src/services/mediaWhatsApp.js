const axios = require("axios");
const { uploadToCloudinary, uploadMediaToCloudinary } = require("./cloudinaryService");
const OpenAI = require("openai");
const tmp = require("tmp");
const fs = require("fs");

async function getMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/${process.env.WA_API_VERSION || "v19.0"}/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` } },
  );
  return response.data.url;
}

// ── Descarga con validación de integridad + reintentos ──────────────────────
// Antes: axios devolvía el buffer "tal cual" sin chequear si el stream se
// cortó a mitad de camino. Si Meta/CDN cerraba la conexión antes de tiempo,
// el archivo quedaba truncado y se subía igual a Cloudinary sin ningún error.
async function downloadMedia(url, { intentos = 3 } = {}) {
  let ultimoError = null;

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
        timeout: 30000, // 30s — si la descarga no arranca/avanza, falla en vez de colgarse
        maxContentLength: 50 * 1024 * 1024, // 50MB
        maxBodyLength: 50 * 1024 * 1024,
      });

      const buffer = Buffer.from(response.data);
      const contentLengthHeader = response.headers["content-length"];

      if (contentLengthHeader) {
        const esperado = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(esperado) && buffer.length !== esperado) {
          throw new Error(
            `Descarga truncada: esperado ${esperado} bytes, recibido ${buffer.length} bytes`,
          );
        }
      } else {
        console.warn(
          `⚠️ Respuesta de media sin header content-length, no se puede validar integridad (recibido ${buffer.length} bytes)`,
        );
      }

      if (buffer.length === 0) {
        throw new Error("Descarga vacía (0 bytes)");
      }

      if (intento > 1) {
        console.log(`✅ Descarga de media OK en intento ${intento}/${intentos}`);
      }

      return buffer;
    } catch (err) {
      ultimoError = err;
      console.warn(`⚠️ Falló descarga de media (intento ${intento}/${intentos}): ${err.message}`);
      if (intento < intentos) {
        // pequeño backoff antes de reintentar
        await new Promise(r => setTimeout(r, 1000 * intento));
      }
    }
  }

  throw new Error(
    `No se pudo descargar el media tras ${intentos} intentos: ${ultimoError?.message}`,
  );
}

async function transcribirAudio(buffer) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmpFile = tmp.fileSync({ postfix: ".ogg" });

  try {
    fs.writeFileSync(tmpFile.name, buffer);
    const transcripcion = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile.name),
      model: "whisper-1",
      language: "es",
      prompt:
        "Conversación sobre compra y venta de autos en una concesionaria. Marcas: Toyota, Volkswagen, Ford, Fiat, Chevrolet, Renault, Peugeot, Citroën, Honda, Nissan, Amarok, Hilux, Ranger, Cronos, Sandero, Tracker. Términos: financiación, prenda, cuotas, kilometraje, patente, transferencia, seña, parte de pago.",
    });
    return transcripcion.text;
  } finally {
    tmpFile.removeCallback(); // siempre limpia el archivo temporal
  }
}

async function procesarMedia(mediaId) {
  const tempUrl = await getMediaUrl(mediaId);
  const buffer = await downloadMedia(tempUrl);
  const result = await uploadToCloudinary(buffer, "whatsapp_media");
  return { url: result.secure_url, publicId: result.public_id, resourceType: "image" };
}

// Devuelve {url, publicId, resourceType} — necesario para poder borrar el
// archivo de Cloudinary más adelante (ver eliminarConversacion.js).
async function procesarMediaDesdeBuffer(buffer, mediaType) {
  const folder = mediaType === "audio" ? "whatsapp_audio" : "whatsapp_media";

  // audio/video van sin las transformaciones de imagen (webp/resize)
  if (mediaType === "audio" || mediaType === "video") {
    const result = await uploadMediaToCloudinary(buffer, folder, "video");
    return { url: result.secure_url, publicId: result.public_id, resourceType: "video" };
  }

  const result = await uploadToCloudinary(buffer, folder);
  return { url: result.secure_url, publicId: result.public_id, resourceType: "image" };
}

module.exports = {
  procesarMedia,
  procesarMediaDesdeBuffer,
  transcribirAudio,
  downloadMedia,
  getMediaUrl,
};
