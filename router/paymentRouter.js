const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment.controller");
const { authMiddleware } = require("../middleware/auth");
router.post("/create-order", authMiddleware, paymentController.createOrder);
router.post("/verify-payment", authMiddleware, paymentController.verifyPayment);

module.exports = router;
