const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const getVentas    = require("../middlewares/ventas/getVentas");
const createVenta  = require("../middlewares/ventas/createVenta");
const updateVenta  = require("../middlewares/ventas/updateVenta");
const deleteVenta  = require("../middlewares/ventas/deleteVenta");

const router = Router();

// Ventas es admin/supervisor (igual que en App.jsx); dentro, updateVenta y
// deleteVenta todavía restringen a supervisor solo-lectura. El socio solo
// puede leer (ve únicamente las ventas de sus autos — filtrado en
// getVentas.js); crear/editar/borrar ventas lo sigue haciendo solo el admin.
router.use(authMiddleware);

router.get("/",        requireRole("admin", "supervisor", "socio"), getVentas);
router.post("/",       requireRole("admin", "supervisor"), createVenta);
router.put("/:id",     requireRole("admin", "supervisor"), updateVenta);
router.delete("/:id",  requireRole("admin", "supervisor"), deleteVenta);

module.exports = router;
