// routes/dashboard.js
const { Router } = require("express");
const { authMiddleware } = require("../middlewares/admin/authMiddleware");
const getDashboard = require("../middlewares/crm/dashboard/getDashboard");
const router = Router();
router.get("/", authMiddleware, getDashboard);
module.exports = router;
