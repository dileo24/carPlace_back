const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const listarGastos = require("../middlewares/gastos/listarGastos");
const crearGasto = require("../middlewares/gastos/crearGasto");
const eliminarGasto = require("../middlewares/gastos/eliminarGasto");

const router = Router();

// Gastos generales del negocio (Facturación): solo admin.
router.use(authMiddleware, requireRole("admin"));

router.get("/", listarGastos);
router.post("/", crearGasto);
router.delete("/:id", eliminarGasto);

module.exports = router;
