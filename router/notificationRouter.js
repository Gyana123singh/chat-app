const router = require("express").Router();
const { authMiddleware } = require("../middleware/auth");
const controller = require("../controllers/notificationController");

router.get("/", authMiddleware, controller.getNotifications);
router.put("/:id/read", authMiddleware, controller.markAsRead);

module.exports = router;
