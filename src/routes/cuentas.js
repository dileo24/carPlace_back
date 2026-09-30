const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const listarDeudas = require("../middlewares/cuentas/listarDeudas");
const crearDeuda = require("../middlewares/cuentas/crearDeuda");
const saldarDeuda = require("../middlewares/cuentas/saldarDeuda");

const router = Router();

// Cuenta corriente: solo usuarios con rol admin la ven y la editan. No hay
// DELETE a propósito: una deuda cargada solo se puede saldar, nunca borrar.
router.use(authMiddleware, requireRole("admin"));

router.get("/", listarDeudas);
router.post("/", crearDeuda);
router.patch("/:id/saldar", saldarDeuda);

module.exports = router;
