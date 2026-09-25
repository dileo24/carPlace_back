const { Router } = require("express");
const { authMiddleware } = require("../middlewares/admin/authMiddleware");
const router = Router();

const getConfiguracion = require("../middlewares/crm/configuracion/getConfiguracion");
const updateConfiguracion = require("../middlewares/crm/configuracion/updateConfiguracion");

router.use(authMiddleware);

router.get("/:clave", getConfiguracion);
router.put("/:clave", updateConfiguracion);

module.exports = router;
