const router = require("express").Router();
const {
  createReport,
  getAllReports,
  updateReportStatus,
  deleteReport,
} = require("../controllers/reportController");

// Public / Authenticated route to submit reports
router.post("/reports", createReport);
router.post("/create", createReport);

// Admin moderation endpoints
router.get("/get-all-reports", getAllReports);
router.get("/admin/reports", getAllReports);
router.put("/admin/reports/:id/status", updateReportStatus);
router.put("/reports/:id/status", updateReportStatus);
router.delete("/admin/reports/:id", deleteReport);
router.delete("/reports/:id", deleteReport);

module.exports = router;
