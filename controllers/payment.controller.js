const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const razorpay = require("../config/razorpay");
const Transaction = require("../models/transaction");
const User = require("../models/users");
const CoinPlan = require("../models/coinPlan");

// GET /api/coins/packages
exports.getCoinPackages = async (req, res) => {
  try {
    const packages = await CoinPlan.find({ active: true }).sort({ amount: 1 });

    return res.json({
      success: true,
      packages: packages.map((pkg) => ({
        _id: pkg._id,
        amount: pkg.amount,
        coins: pkg.coins,
        bonusCoins: pkg.bonusCoins || 0,
        totalCoins: pkg.totalCoins,
        discount: pkg.discount || 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching packages:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching packages",
      error: error.message,
    });
  }
};

// POST /api/coins/create-order
exports.createOrder = async (req, res) => {
  try {
    const { packageId, paymentMethod = "upi" } = req.body;
    const userId = req.user.id;

    const coinPackage = await CoinPlan.findById(packageId);
    if (!coinPackage || !coinPackage.active) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or inactive package" });
    }

    const transactionId = uuidv4();

    const options = {
      amount: coinPackage.amount * 100,
      currency: "INR",
      receipt: transactionId,
      payment_capture: 1,
      notes: {
        userId,
        packageId: coinPackage._id.toString(),
        coins: coinPackage.totalCoins,
        transactionId,
      },
    };

    const order = await razorpay.orders.create(options);

    const transaction = new Transaction({
      transactionId,
      userId,
      packageId: coinPackage._id,
      type: "COIN_RECHARGE",
      coinsAdded: coinPackage.totalCoins,
      razorpayOrderId: order.id,
      amount: coinPackage.amount,
      status: "PENDING",
      paymentMethod,
    });

    await transaction.save();

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      coins: coinPackage.totalCoins,
      baseCoins: coinPackage.coins,
      bonusCoins: coinPackage.bonusCoins || 0,
      packageId: coinPackage._id,
      transactionId,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating order",
      error: error.message,
    });
  }
};

// POST /api/coins/verify-payment
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      transactionId,
    } = req.body;
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

    const transaction = await Transaction.findOne({
      razorpayOrderId,
      transactionId,
      userId,
    });

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    if (transaction.status === "SUCCESS") {
      return res.json({
        success: true,
        message: "Payment already verified",
      });
    }

    transaction.razorpayPaymentId = razorpayPaymentId;
    transaction.razorpaySignature = razorpaySignature;
    transaction.status = "SUCCESS";
    transaction.completedAt = new Date();
    await transaction.save();

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          coins: transaction.coinsAdded,
          totalSpent: transaction.amount,
        },
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: "Payment verified and coins added",
      coinsAdded: transaction.coinsAdded,
      newBalance: user.coins,
      transactionId: transaction.transactionId,
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message,
    });
  }
};

// GET /api/coins/balance
exports.getBalance = async (req, res) => {
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
      coinBalance: user.coins,
      totalSpent: user.totalSpent,
      totalEarned: user.totalEarned,
    });
  } catch (error) {
    console.error("Error fetching balance:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching balance",
      error: error.message,
    });
  }
};
