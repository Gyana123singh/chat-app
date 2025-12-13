const router = require("express").Router();
const { adminLogin } = require("../controllers/adminContrroler");

router.post("/admin/login", adminLogin);
module.exports = router;
