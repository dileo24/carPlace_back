const { Router } = require("express");
const { authMiddleware } = require("../middlewares/admin/authMiddleware");
const getSidebarBadges = require("../middlewares/crm/getSidebarBadges");
const router = Router();
router.get("/", authMiddleware, getSidebarBadges);
module.exports = router;
