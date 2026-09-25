const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const listarDeudas = require("../middlewares/cuentas/listarDeudas");
const crearDeuda = require("../middlewares/cuentas/crearDeuda");
const eliminarDeuda = require("../middlewares/cuentas/eliminarDeuda");

const router = Router();

// Cuenta corriente entre socios (Admin): solo admins la ven y la editan.
router.use(authMiddleware, requireRole("admin"));

router.get("/", listarDeudas);
router.post("/", crearDeuda);
router.delete("/:id", eliminarDeuda);

module.exports = router;
