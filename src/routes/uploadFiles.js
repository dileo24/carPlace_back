const { Router } = require("express");
const { authMiddleware } = require("../middlewares/admin/authMiddleware");
const { upload, uploadCarousel } = require("../middlewares/files/multerConfig");

const getCarousel = require("../middlewares/files/carousel/getCarousel");
const reorderCarousel = require("../middlewares/files/carousel/reorderCarousel");
const getCarouselImage = require("../middlewares/files/carousel/getCarouselImage");
const uploadCarouselImages = require("../middlewares/files/carousel/uploadCarousel");
const deleteCarouselImage = require("../middlewares/files/carousel/deleteCarouselImage");

const getGeneralImage = require("../middlewares/files/general/getGeneralImage");
const uploadGeneral = require("../middlewares/files/general/uploadGeneral");
const deleteGeneralImage = require("../middlewares/files/general/deleteGeneralImage");

const router = Router();

// ========== Carrusel (página Nosotros) ========== //
router.get("/carousel", getCarousel);
router.patch("/carousel/reorder", authMiddleware, reorderCarousel);
router.get("/carousel/:id", getCarouselImage);
router.post("/carousel", authMiddleware, uploadCarousel.array("files", 20), uploadCarouselImages);
router.delete("/carousel/:id", authMiddleware, deleteCarouselImage);

// ========== Uploads generales (fotos de autos, etc.) ========== //
router.get("/:clientId", getGeneralImage);
router.post("/", authMiddleware, upload.single("file"), uploadGeneral);
router.delete("/:id", authMiddleware, deleteGeneralImage);

module.exports = router;
