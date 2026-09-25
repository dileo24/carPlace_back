const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const getPublicaciones = require("../middlewares/publicaciones/getPublicaciones");
const getCupoPublicaciones = require("../middlewares/publicaciones/getCupoPublicaciones");
const getAutosPublicadosIds = require("../middlewares/publicaciones/getAutosPublicadosIds");
const crearPublicacion = require("../middlewares/publicaciones/crearPublicacion");
const borrarRegistroPublicacion = require("../middlewares/publicaciones/borrarRegistroPublicacion");
const {
  pausarPublicacion,
  cerrarPublicacion,
  eliminarPublicacion,
  reactivarPublicacion,
  republicarPublicacion,
} = require("../middlewares/publicaciones/cambiarEstadoPublicacion");

const router = Router();

// Todo admin-only — esto es gestión interna del stock, no hay nada público acá.
router.get("/", authMiddleware, requireRole("admin"), getPublicaciones);
router.get("/cupo", authMiddleware, requireRole("admin"), getCupoPublicaciones);
// Cualquier rol logueado que vea el Stock necesita saber qué autos ya están
// en MercadoLibre (badge informativo) — no hace falta ser admin para esto.
router.get("/autos-publicados", authMiddleware, getAutosPublicadosIds);
router.post("/", authMiddleware, requireRole("admin"), crearPublicacion);
router.put("/:id/pausar", authMiddleware, requireRole("admin"), pausarPublicacion);
router.put("/:id/cerrar", authMiddleware, requireRole("admin"), cerrarPublicacion);
router.put("/:id/eliminar", authMiddleware, requireRole("admin"), eliminarPublicacion);
router.put("/:id/reactivar", authMiddleware, requireRole("admin"), reactivarPublicacion);
router.post("/:id/republicar", authMiddleware, requireRole("admin"), republicarPublicacion);
router.delete("/:id", authMiddleware, requireRole("admin"), borrarRegistroPublicacion);

module.exports = router;
