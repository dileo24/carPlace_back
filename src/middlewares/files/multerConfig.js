const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");

const uploadDir = path.join(os.tmpdir(), "uploads");
const carouselDir = path.join(uploadDir, "carousel");

[uploadDir, carouselDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const fileFilter = (req, file, cb) => {
  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (validTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb({
      status: 400,
      resp: "Formato no válido. Use: PNG, JPEG, JPG o WEBP",
      input: "file",
      storageErrors: [],
    });
  }
};

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `img_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});

const uploadCarousel = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
});

module.exports = { upload, uploadCarousel };
