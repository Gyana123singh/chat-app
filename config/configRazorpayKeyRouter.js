// routes/config.routes.js
const express = require("express");
const router = express.Router();

router.get("/razorpay-key", (req, res) => {
  return res.json({
    success: true,
    key: process.env.RAZORPAY_KEY_ID, // rzp_test_xxx
  });
});

module.exports = router;
