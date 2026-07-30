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
  addCoinsToUser,
  deductCoinsFromUser,
  getProfitLossConfig,
  updateProfitLossConfig,
  getDashboardStats,
  getHelpRooms,
  createHelpRoom,
  updateHelpRoom,
  deleteHelpRoom,
  toggleUserBan,
} = require("../controllers/adminContrroler");
const upload = require("../middleware/multer.middleware");
const { authMiddleware } = require("../middleware/auth");

const adminCheck = (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin role required.",
    });
  }
  next();
};

router.post("/register", registerUser);
router.post("/admin/login", adminLogin);

// api for getting all users
router.get("/get-all-user", getAllUsers);
router.post("/toggle-user-ban", toggleUserBan);
router.post("/coin-mapping", updateCoinMapping); // api for post coin mapping
router.get("/get-coin-mapping", getCoinMapping); // api for getting coin mapping
router.post("/calculate-coins", calculateCoins); // api for calculate coins
router.post("/recharge-plan", addRechargePlan); // api for reacharge plan
router.get("/get-recharge-plans", getRechargePlans); // api for get all recharge-plans
router.delete("/delete-recharge-plan/:id", deleteRechargePlan); // api for get all recharge-plans
router.post("/add-coins", addCoinsToUser);
router.post("/deduct-coins", deductCoinsFromUser);

// profit & loss configuration endpoints
router.get("/profit-loss-config", getProfitLossConfig);
router.post("/profit-loss-config", updateProfitLossConfig);

// dashboard statistics
router.get("/dashboard/stats", getDashboardStats);

// Help Room management
router.get("/help-room", authMiddleware, adminCheck, getHelpRooms);
router.post("/help-room", authMiddleware, adminCheck, upload.single("avatar"), createHelpRoom);
router.put("/help-room/:roomId", authMiddleware, adminCheck, upload.single("avatar"), updateHelpRoom);
router.delete("/help-room/:roomId", authMiddleware, adminCheck, deleteHelpRoom);

module.exports = router;
