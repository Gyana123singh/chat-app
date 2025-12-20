const router = require("express").Router();
const { adminLogin } = require("../controllers/adminContrroler");
const {authMiddleware}=require("../middleware/auth")
router.post("/admin/login",authMiddleware, adminLogin);
module.exports = router;
