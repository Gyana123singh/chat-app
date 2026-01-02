const bcrypt = require("bcryptjs");
const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");
const coinMapping = require("../models/coinMapping");
const CoinPlan = require("../models/coinPlan");

exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1️⃣ Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // 2️⃣ Find ADMIN user only
    const admin = await User.findOne({ email }).select("+password");

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
      });
    }

    // 3️⃣ Compare password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // 4️⃣ Sign JWT
    const token = signToken(admin);

    // 5️⃣ Success response
    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      user: {
        id: admin._id,
        email: admin.email,
        username: admin.username,
      },
    });
  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // 1️⃣ Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // 2️⃣ Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    // 3️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Create user
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: "user",
    });

    // 5️⃣ Generate token
    const token = signToken(user);

    // 6️⃣ Success
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

//api for get all users

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find();

    res.status(200).json({
      success: true,
      message: "Fetched all users successfully",
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

exports.updateCoinMapping = async (req, res) => {
  const { rate } = req.body;

  if (!rate || rate <= 0) {
    return res.status(400).json({ message: "Invalid rate" });
  }

  let config = await coinMapping.findOne();

  if (!config) {
    config = await coinMapping.create({ rate });
  } else {
    config.rate = rate;
    await config.save();
  }

  res.json({
    message: "INR → Coin mapping updated",
    rate: config.rate,
  });
};

exports.getCoinMapping = async (req, res) => {
  const config = await coinMapping.findOne();
  res.json({ rate: config?.rate || 0 });
};

// api for calculate the coin for the UI
exports.calculateCoins = async (req, res) => {
  try {
    const { amountINR } = req.body;

    if (!amountINR || amountINR <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const config = await coinMapping.findOne();
    if (!config) {
      return res.status(500).json({ message: "Coin mapping not set" });
    }

    const coins = amountINR * config.rate;

    res.json({
      success: true,
      amountINR,
      rate: config.rate,
      coins,
    });
  } catch (error) {
    console.error("Calculate Coins Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Add Recharge Plan with calculated coins (secure)
exports.addRechargePlan = async (req, res) => {
  try {
    // 🔒 Convert input explicitly
    const amount = Number(req.body.amount);
    const bonusCoins = Number(req.body.bonusCoins || 0);

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const config = await coinMapping.findOne();
    if (!config) {
      return res.status(400).json({
        message: "Coin mapping not set",
      });
    }

    const baseCoins = amount * Number(config.rate);
    const totalCoins = baseCoins + bonusCoins;

    const plan = await CoinPlan.create({
      amount,
      coins: baseCoins,
      bonusCoins,
      totalCoins,
    });

    res.status(201).json({
      success: true,
      message: "Recharge plan created",
      plan,
    });
  } catch (error) {
    console.error("Add Recharge Plan Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Get All Recharge Plans
exports.getRechargePlans = async (req, res) => {
  try {
    const plans = await CoinPlan.find({ active: true }).sort({ amount: 1 });

    res.status(200).json({
      success: true,
      count: plans.length,
      plans,
    });
  } catch (error) {
    console.error("Get Recharge Plans Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Soft delete recharge plan
exports.deleteRechargePlan = async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await CoinPlan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Recharge plan not found",
      });
    }

    plan.active = false;
    await plan.save();

    res.status(200).json({
      success: true,
      message: "Recharge plan deleted successfully",
    });
  } catch (error) {
    console.error("Delete Recharge Plan Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
