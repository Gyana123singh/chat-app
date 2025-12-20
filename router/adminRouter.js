const router = require("express").Router();
const { adminLogin, registerUser } = require("../controllers/adminContrroler");

router.post("/register", registerUser);
router.post("/admin/login", adminLogin);
module.exports = router;
