// routes/getReportes.js
const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const getReportes = require("../middlewares/crm/getReportes");
const router = Router();
// getReportes.js filtra el dataset y recorta secciones según el rol (ver ahí):
// admin ve todo, supervisor no ve autos/ventas del socio, el socio solo ve lo
// suyo y sin embudo/performance de asesores/orígenes/bot.
router.get("/", authMiddleware, requireRole("admin", "supervisor", "socio"), getReportes);
module.exports = router;
