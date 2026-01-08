const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const razorpay = require("../config/razorpay");
const { COIN_PACKAGES } = require("../config/razorpay");
const Transaction = require("../models/transaction");
const User = require("../models/users");

exports.createOrder = async (req, res) => {
  try {
    const { packageType } = req.body;
    const userId = req.user.id;

    if (!COIN_PACKAGES[packageType]) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid package type" });
    }

    const packageData = COIN_PACKAGES[packageType];
    const transactionId = uuidv4();

    const options = {
      amount: packageData.price * 100,
      currency: "INR",
      receipt: transactionId,
      payment_capture: 1,
      notes: { userId, packageType, coins: packageData.coins, transactionId },
    };

    const order = await razorpay.orders.create(options);

    const transaction = new Transaction({
      transactionId,
      userId,
      type: "COIN_RECHARGE",
      coinsAdded: packageData.coins,
      razorpayOrderId: order.id,
      amount: packageData.price,
      status: "PENDING",
    });
    await transaction.save();

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      coins: packageData.coins,
      packageType,
      transactionId,
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const userId = req.user.id;

    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res
        .status(400)
        .json({ success: false, message: "Payment verification failed" });
    }

    const transaction = await Transaction.findOne({ razorpayOrderId });
    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    transaction.razorpayPaymentId = razorpayPaymentId;
    transaction.status = "SUCCESS";
    await transaction.save();

    const user = await User.findById(userId);
    user.coinBalance += transaction.coinsAdded;
    user.totalRecharged += transaction.amount;
    await user.save();

    return res.json({
      success: true,
      message: "Payment verified and coins added",
      coinsAdded: transaction.coinsAdded,
      newBalance: user.coinBalance,
      transactionId: transaction.transactionId,
    });
  } catch (error) {
    next(error);
  }
};

// Get packages
// app.get("/api/recharge/packages", (req, res) => {
//   return res.json({ success: true, packages: COIN_PACKAGES });
// });

// Get All profile coin management

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        coinBalance: user.coinBalance,
        totalSpent: user.totalSpent,
        totalRecharged: user.totalRecharged,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
