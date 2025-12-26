const express = require("express");
const router = express.Router();

const {
  firebaseOtpLogin,
} = require("../controllers/authFirebaseOtpController");

router.post("/firebase-otp-login", firebaseOtpLogin);
module.exports = router;
