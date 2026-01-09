const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");
const { authMiddleware } = require("../middleware/auth");
router.get("/get-coin-packages", paymentController.getCoinPackages);
router.post("/create-order", authMiddleware, paymentController.createOrder);
router.post("/verify-payment", authMiddleware, paymentController.verifyPayment);
router.get("/balance", authMiddleware, paymentController.getBalance);
// router.post("/handle-webhook", paymentController.handleWebhook);
// router.post("/refund-payment", authMiddleware, paymentController.refundPayment);

// router.post("/get-transaction-status", authMiddleware, paymentController.getTransactionStatus);

module.exports = router;
