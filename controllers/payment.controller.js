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
      razorpayKey: process.env.RAZORPAY_KEY_ID,
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
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      transactionId, // ✅ REQUIRED
    } = req.body;

    const userId = req.user.id;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID missing",
      });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET) // ✅ FIXED
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    const transaction = await Transaction.findOne({
      transactionId,
      razorpayOrderId: razorpay_order_id,
      userId,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    if (transaction.status === "SUCCESS") {
      return res.json({
        success: true,
        message: "Payment already verified",
      });
    }

    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
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
// GET /api/coins/history
exports.getPurchaseHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, skip = 0 } = req.query;

    const transactions = await Transaction.find({
      userId,
      type: "COIN_RECHARGE",
      status: "SUCCESS",
    })
      .populate("packageId")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .lean();

    const total = await Transaction.countDocuments({
      userId,
      type: "COIN_RECHARGE",
      status: "SUCCESS",
    });

    return res.json({
      success: true,
      history: transactions,
      total,
      limit: Number(limit),
      skip: Number(skip),
    });
  } catch (error) {
    console.error("Error fetching purchase history:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching purchase history",
    });
  }
};

// POST /api/coins/transfer
exports.transferCoins = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverDisplayId, amount } = req.body;
    const transferAmount = parseInt(amount);

    if (!receiverDisplayId || !transferAmount || transferAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid receiver ID and amount are required" });
    }

    const User = require("../models/users");
    const Transaction = require("../models/transaction");

    const sender = await User.findById(senderId);
    if (!sender || sender.coins < transferAmount) {
      return res.status(400).json({ success: false, message: "Insufficient coins" });
    }

    // Try finding by displayId or username
    const searchConditions = [{ username: receiverDisplayId }];
    if (!isNaN(receiverDisplayId)) {
      searchConditions.push({ displayId: Number(receiverDisplayId) });
    }

    const receiver = await User.findOne({
      $or: searchConditions
    });

    if (!receiver) {
      return res.status(404).json({ success: false, message: "Receiver not found" });
    }

    if (receiver._id.toString() === senderId.toString()) {
      return res.status(400).json({ success: false, message: "Cannot transfer coins to yourself" });
    }

    sender.coins -= transferAmount;
    receiver.coins += transferAmount;
    
    await sender.save();
    await receiver.save();

    await Transaction.create({
      userId: sender._id,
      type: "COIN_TRANSFER",
      amount: 0,
      coinsAdded: -transferAmount,
      status: "SUCCESS",
      receiver: receiver._id,
      message: `Transferred coins to ${receiver.username}`
    });

    await Transaction.create({
      userId: receiver._id,
      type: "COIN_TRANSFER",
      amount: 0,
      coinsAdded: transferAmount,
      status: "SUCCESS",
      sender: sender._id,
      message: `Received coins from ${sender.username}`
    });

    return res.json({
      success: true,
      message: "Coins transferred successfully",
      newBalance: sender.coins,
    });
  } catch (error) {
    console.error("Error transferring coins:", error);
    return res.status(500).json({ success: false, message: "Error transferring coins", error: error.message });
  }
};
