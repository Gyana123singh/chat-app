const router = require("express").Router();
const {
  adminLogin,
  registerUser,
  getAllUsers,
  updateCoinMapping,
  getCoinMapping,
  calculateCoins,
  addRechargePlan,
  getRechargePlans,
  deleteRechargePlan,
} = require("../controllers/adminContrroler");

router.post("/register", registerUser);
router.post("/admin/login", adminLogin);

// api for getting all users
router.get("/get-all-user", getAllUsers);
router.post("/coin-mapping", updateCoinMapping); // api for post coin mapping
router.get("/get-coin-mapping", getCoinMapping); // api for getting coin mapping
router.post("/calculate-coins", calculateCoins); // api for calculate coins
router.post("/recharge-plan", addRechargePlan); // api for reacharge plan
router.get("/get-recharge-plans", getRechargePlans); // api for get all recharge-plans
router.delete("/delete-recharge-plan/:id", deleteRechargePlan); // api for get all recharge-plans
module.exports = router;
