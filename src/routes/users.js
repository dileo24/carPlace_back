const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const createUser = require("../middlewares/users/createUser");
const getUsers = require("../middlewares/users/getUsers");
const editUser = require("../middlewares/users/editUser");
const deleteUser = require("../middlewares/users/deleteUser");

const router = Router();

router.use(authMiddleware);

router.post("/", requireRole("admin"), createUser);
router.get("/", getUsers);
router.patch("/:id", requireRole("admin"), editUser);
router.delete("/:id", requireRole("admin"), deleteUser);

module.exports = router;
