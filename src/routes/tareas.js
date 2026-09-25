const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const allTareas    = require("../middlewares/tareas/allTareas");
const getTareaById = require("../middlewares/tareas/getTareaById");
const createTarea  = require("../middlewares/tareas/createTarea");
const updateTarea  = require("../middlewares/tareas/updateTarea");
const deleteTarea  = require("../middlewares/tareas/deleteTarea");

const router = Router();

// Tareas es una sección interna de admin/supervisor/socio (así la restringe
// el frontend en App.jsx); el vendedor/publicador_vendedor no debería poder
// leerla ni escribirla ni yendo directo a la API. El socio solo ve/edita sus
// propias tareas (filtrado en allTareas.js/updateTarea.js/getTareaById.js).
router.use(authMiddleware, requireRole("admin", "supervisor", "socio"));

router.get("/",      allTareas);
router.get("/:id",   getTareaById);
router.post("/",     createTarea);
router.put("/:id",   updateTarea);
router.delete("/:id", deleteTarea);

module.exports = router;
