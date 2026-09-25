const { Router } = require("express");
const { authMiddleware, optionalAuth, requireRole } = require("../middlewares/admin/authMiddleware");
const getMarcas = require("../middlewares/marcas/getMarcas");
const getAutosPorMarca = require("../middlewares/marcas/getAutosPorMarca");
const createMarca = require("../middlewares/marcas/createMarca");
const updateMarca = require("../middlewares/marcas/updateMarca");
const deleteMarca = require("../middlewares/marcas/deleteMarca");

const router = Router();

// Público (o con sesión si hay) — lo usan tanto el módulo admin como el
// carrusel/filtro de marcas del sitio público.
router.get("/", optionalAuth, getMarcas);
router.get("/:id/autos", optionalAuth, getAutosPorMarca);

// Gestión: solo admin.
router.post("/", authMiddleware, requireRole("admin"), createMarca);
router.put("/:id", authMiddleware, requireRole("admin"), updateMarca);
router.delete("/:id", authMiddleware, requireRole("admin"), deleteMarca);

module.exports = router;
