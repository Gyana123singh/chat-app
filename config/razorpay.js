// config/razorpay.js
const Razorpay = require("razorpay");

module.exports = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const COIN_PACKAGES = {
  basic: { coins: 7500, price: 100 },
  standard: { coins: 15000, price: 200 },
  premium: { coins: 50000, price: 500 },
  diamond: { coins: 100000, price: 1000 },
};
module.exports.COIN_PACKAGES = COIN_PACKAGES;