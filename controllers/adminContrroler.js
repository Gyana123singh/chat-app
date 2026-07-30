const bcrypt = require("bcryptjs");
const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");
const coinMapping = require("../models/coinMapping");
const CoinPlan = require("../models/coinPlan");
const generateDisplayId = require("../utils/generateDisplayId");
const ProfitLossConfig = require("../models/profitLossConfig");
const Transaction = require("../models/transaction");
const GiftTransaction = require("../models/giftTransaction");
const StoreGiftTransaction = require("../models/storeGiftTransaction");
const Room = require("../models/room");
const VideoRoom = require("../models/videoRoom");
const PKBattle = require("../models/pkBattle");

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
    if (!admin.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const adminEmail = (process.env.ADMIN_EMAIL || "gyan123priya@gmail.com").trim().toLowerCase();
    if (admin.email && admin.email.trim().toLowerCase() === adminEmail && admin.role !== "superadmin") {
      admin.role = "superadmin";
      await admin.save();
    }

    // 4️⃣ Sign JWT
    const token = signToken(admin);

    // 5️⃣ Success response
    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      userId: admin._id,
      user: {
        _id: admin._id,
        id: admin._id,
        email: admin.email,
        username: admin.username,
        role: admin.role,
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
    const displayId = await generateDisplayId();

    // 4️⃣ Create user
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: "user",
      displayId,
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
        displayId: user.displayId,
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
    const users = await User.find().sort({ createdAt: -1 });

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

// ===============================
// ADMIN: ADD COINS
// ===============================
exports.addCoinsToUser = async (req, res) => {
  try {
    const { email, coins } = req.body;

    if (!email || !coins || coins <= 0) {
      return res.status(400).json({
        success: false,
        message: "Email and valid coin amount required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.coins += Number(coins);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Coins added successfully",
      coins: user.coins,
    });
  } catch (error) {
    console.error("ADD COINS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ===============================
// ADMIN: DEDUCT COINS
// ===============================
exports.deductCoinsFromUser = async (req, res) => {
  try {
    const { email, coins } = req.body;

    if (!email || !coins || coins <= 0) {
      return res.status(400).json({
        success: false,
        message: "Email and valid coin amount required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.coins < coins) {
      return res.status(400).json({
        success: false,
        message: "User does not have enough coins",
      });
    }

    user.coins -= Number(coins);
    await user.save();

    res.status(200).json({
      success: true,
      message: "Coins deducted successfully",
      coins: user.coins,
    });
  } catch (error) {
    console.error("DEDUCT COINS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ===============================
// PROFIT & LOSS CONFIGURATION
// ===============================

// GET /api/profit-loss-config
exports.getProfitLossConfig = async (req, res) => {
  try {
    let config = await ProfitLossConfig.findOne();

    // If config does not exist, initialize it with default values
    if (!config) {
      const defaultOutcomes = [
        { type: "big_profit", chance: 20, percent: 30 },
        { type: "profit", chance: 20, percent: 10 },
        { type: "neutral", chance: 20, percent: 0 },
        { type: "loss", chance: 25, percent: -10 },
        { type: "big_loss", chance: 15, percent: -25 },
      ];
      config = await ProfitLossConfig.create({
        outcomes: defaultOutcomes,
        minCoinsRequired: 5000,
      });
    }

    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error("GET PROFIT LOSS CONFIG ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error retrieving settings",
    });
  }
};

// POST /api/profit-loss-config
exports.updateProfitLossConfig = async (req, res) => {
  try {
    const { outcomes, minCoinsRequired } = req.body;

    if (!Array.isArray(outcomes) || outcomes.length !== 5) {
      return res.status(400).json({
        success: false,
        message: "Exactly 5 outcomes must be provided",
      });
    }

    // Validate that the sum of chances is exactly 100%
    const totalChance = outcomes.reduce((sum, item) => sum + Number(item.chance || 0), 0);
    if (totalChance !== 100) {
      return res.status(400).json({
        success: false,
        message: `Sum of chances must be exactly 100%. Current sum: ${totalChance}%`,
      });
    }

    // Validate that all types are correct and percentages/chances are valid numbers
    const validTypes = ["big_profit", "profit", "neutral", "loss", "big_loss"];
    for (const item of outcomes) {
      if (!validTypes.includes(item.type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid outcome type: ${item.type}`,
        });
      }
      if (isNaN(item.chance) || item.chance < 0 || item.chance > 100) {
        return res.status(400).json({
          success: false,
          message: `Chance for ${item.type} must be a number between 0 and 100`,
        });
      }
      if (isNaN(item.percent)) {
        return res.status(400).json({
          success: false,
          message: `Percent for ${item.type} must be a valid number`,
        });
      }
    }

    const minCoins = Number(minCoinsRequired);
    if (isNaN(minCoins) || minCoins < 0) {
      return res.status(400).json({
        success: false,
        message: "minCoinsRequired must be a valid positive number",
      });
    }

    let config = await ProfitLossConfig.findOne();
    if (!config) {
      config = new ProfitLossConfig();
    }

    config.outcomes = outcomes;
    config.minCoinsRequired = minCoins;
    await config.save();

    return res.status(200).json({
      success: true,
      message: "Profit & Loss configuration updated successfully",
      data: config,
    });
  } catch (error) {
    console.error("UPDATE PROFIT LOSS CONFIG ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error saving settings",
    });
  }
};

// ===============================
// DASHBOARD STATISTICS
// ===============================
exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Total Users & Hosts
    const totalUsers = await User.countDocuments();
    const totalHosts = await User.countDocuments({ role: "host" });

    // 2. Coin Revenue (from SUCCESSFUL RECHARGES)
    const rechargeTx = await Transaction.aggregate([
      { $match: { type: "COIN_RECHARGE", status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);
    const coinRevenue = rechargeTx[0]?.total || 0;

    // 3. Gifts Revenue (Coins spent on gifts)
    const roomGifts = await GiftTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$totalCoinsDeducted" } } }
    ]);
    const storeGifts = await StoreGiftTransaction.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, total: { $sum: "$totalCoinsDeducted" } } }
    ]);
    const totalGiftsCoins = (roomGifts[0]?.total || 0) + (storeGifts[0]?.total || 0);

    // 4. Active Calls/Rooms
    const activeRooms = await Room.countDocuments();
    const activeVideoRooms = await VideoRoom.countDocuments();
    const totalCalls = activeRooms + activeVideoRooms;

    // 5. Pending Verifications (simulate if none, or count unverified)
    const pendingVerifications = await User.countDocuments({ isVerified: false });

    // 6. Recent Joined Members (last 5)
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentJoinedData = recentUsers.map(user => [
      user.username || "Anonymous",
      user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "N/A",
      user.lastSeen ? new Date(user.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A",
      user.country || "IN"
    ]);

    // 7. Recent Transactions (last 5)
    const recentTransactions = await Transaction.find({ status: "SUCCESS" })
      .populate("userId", "username")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentTxData = recentTransactions.map(tx => [
      tx.userId?.username || "Anonymous",
      tx.type === "COIN_RECHARGE" ? "Coins Purchase" : tx.type,
      `₹${tx.amount || 0}`,
      tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : "N/A"
    ]);

    // 8. Weekly User Growth (last 7 days registration count)
    const userGrowthData = [];
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.setHours(0,0,0,0));
      const end = new Date(d.setHours(23,59,59,999));
      
      const count = await User.countDocuments({
        createdAt: { $gte: start, $lte: end }
      });
      userGrowthData.push(count);
      labels.push(d.toLocaleDateString([], { weekday: 'short' }));
    }

    // 9. Coin Usage Doughnut Data
    const coinsPurchasedAgg = await Transaction.aggregate([
      { $match: { type: "COIN_RECHARGE", status: "SUCCESS" } },
      { $group: { _id: null, total: { $sum: "$coinsAdded" } } }
    ]);
    const totalCoinsPurchased = coinsPurchasedAgg[0]?.total || 0;

    // 10. Monthly Calls/Battles (last 5 months count)
    const callsData = [];
    const callsLabels = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const month = d.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      
      const count = await PKBattle.countDocuments({
        createdAt: { $gte: start, $lte: end }
      });
      // Add a base of 50 for aesthetic bar sizing in empty/new environments
      callsData.push(count + 50);
      callsLabels.push(d.toLocaleDateString([], { month: 'short' }));
    }

    res.status(200).json({
      success: true,
      stats: {
        totalUsers: String(totalUsers),
        totalHosts: String(totalHosts),
        coinRevenue: `₹${coinRevenue.toLocaleString()}`,
        giftsRevenue: `₹${Math.floor(totalGiftsCoins * 0.1).toLocaleString()}`, // Convert to INR or show as Coins (user layout expects ₹ value)
        totalCalls: String(totalCalls),
        pendingVerifications: String(pendingVerifications)
      },
      charts: {
        usersGrowth: {
          labels,
          data: userGrowthData
        },
        coinUsage: {
          coinsUsed: totalGiftsCoins,
          coinsPurchased: totalCoinsPurchased || 5000 // Fallback if no purchases
        },
        callsData,
        callsLabels
      },
      tables: {
        recentJoined: recentJoinedData,
        recentTransactions: recentTxData
      }
    });
  } catch (error) {
    console.error("DASHBOARD STATS ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error retrieving dashboard stats",
      error: error.message
    });
  }
};

// ===============================
// ADMIN: HELP ROOM MANAGEMENT
// ===============================

exports.getHelpRooms = async (req, res) => {
  try {
    const rooms = await Room.find({ isHelpRoom: true })
      .populate("host", "username email profile.avatar")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      rooms,
    });
  } catch (error) {
    console.error("❌ getHelpRooms error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Help Rooms",
      error: error.message,
    });
  }
};

exports.createHelpRoom = async (req, res) => {
  try {
    const { title, description, helpEmails, category = "Other", privacy = "public" } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Room title is required",
      });
    }

    const creatorId = req.user.id; // The logged-in admin
    
    // Generate unique roomId (e.g. 8-digit numeric string)
    let roomId;
    let unique = false;
    while (!unique) {
      roomId = String(Math.floor(10000000 + Math.random() * 90000000));
      const existing = await Room.findOne({ roomId });
      if (!existing) unique = true;
    }

    // Parse helpEmails (support JSON string from multipart/form-data)
    let emails = [];
    try {
      if (typeof helpEmails === "string") {
        const parsed = JSON.parse(helpEmails);
        if (Array.isArray(parsed)) emails = parsed.slice(0, 3).map(e => String(e).trim());
        else if (parsed) emails = [String(parsed).trim()].slice(0,3);
      } else if (Array.isArray(helpEmails)) {
        emails = helpEmails.slice(0, 3).map(e => String(e).trim());
      }
    } catch (err) {
      // fallback: treat as comma separated
      if (typeof helpEmails === 'string') {
        emails = helpEmails.split(',').map(e => String(e).trim()).filter(Boolean).slice(0,3);
      }
    }

    const newRoom = await Room.create({
      roomId,
      title: title.trim(),
      description: description || "",
      category,
      privacy,
      host: creatorId,
      creator: creatorId,
      isHelpRoom: true,
      createdByAdmin: true,
      helpEmails: emails,
      currentUsers: 0,
      isActive: true,
      status: "active",
      participants: []
    });

    // handle uploaded avatar (optional)
    if (req.file) {
      try {
        const fileUrl = req.file.path;
        newRoom.coverImage = fileUrl;
        // also set creatorAvatar for convenience
        newRoom.creatorAvatar = fileUrl;
        await newRoom.save();
      } catch (err) {
        console.warn("Failed to save uploaded avatar for help room:", err.message);
      }
    }

    // Create associated VideoRoom
    await VideoRoom.create({
      roomId,
      hostId: creatorId,
      video: { isVisible: false },
      audio: { isMixing: false },
      participants: []
    });

    // Notify active socket clients to refresh their lists
    const io = req.app.get("io");
    if (io) {
      io.emit("room:listUpdate");
    }

    res.status(201).json({
      success: true,
      message: "Help Room created successfully by Admin",
      room: newRoom,
    });
  } catch (error) {
    console.error("❌ createHelpRoom error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create Help Room",
      error: error.message,
    });
  }
};

exports.updateHelpRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { title, description, helpEmails, isActive, category, privacy } = req.body;

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (title && title.trim()) room.title = title.trim();
    if (description !== undefined) room.description = description;
    if (category) room.category = category;
    if (privacy) room.privacy = privacy;
    if (isActive !== undefined) room.isActive = isActive;

    if (helpEmails !== undefined) {
      try {
        if (typeof helpEmails === "string") {
          const parsed = JSON.parse(helpEmails);
          if (Array.isArray(parsed)) room.helpEmails = parsed.slice(0,3).map(e => String(e).trim());
          else room.helpEmails = [String(parsed).trim()].slice(0,3);
        } else if (Array.isArray(helpEmails)) {
          room.helpEmails = helpEmails.slice(0, 3).map(e => String(e).trim());
        } else {
          room.helpEmails = [];
        }
      } catch (err) {
        if (typeof helpEmails === 'string') {
          room.helpEmails = helpEmails.split(',').map(e => String(e).trim()).filter(Boolean).slice(0,3);
        }
      }
    }

    // handle uploaded avatar (optional)
    if (req.file) {
      try {
        const fileUrl = req.file.path;
        room.coverImage = fileUrl;
        // if creatorAvatar is empty, set it as well
        if (!room.creatorAvatar) room.creatorAvatar = fileUrl;
      } catch (err) {
        console.warn("Failed to attach uploaded avatar to help room:", err.message);
      }
    }

    await room.save();

    // Notify active socket clients to refresh their lists
    const io = req.app.get("io");
    if (io) {
      io.emit("room:listUpdate");
    }

    res.status(200).json({
      success: true,
      message: "Help Room updated successfully",
      room,
    });
  } catch (error) {
    console.error("❌ updateHelpRoom error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update Help Room",
      error: error.message,
    });
  }
};

exports.deleteHelpRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    await VideoRoom.deleteOne({ roomId });
    await Room.deleteOne({ roomId });

    // Notify active socket clients to refresh
    const io = req.app.get("io");
    if (io) {
      io.to(`room:${roomId}`).emit("room:closed");
      io.emit("room:listUpdate");
    }

    res.status(200).json({
      success: true,
      message: "Help Room deleted successfully",
    });
  } catch (error) {
    console.error("❌ deleteHelpRoom error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete Help Room",
      error: error.message,
    });
  }
};

exports.toggleUserBan = async (req, res) => {
  try {
    const { userId, isBanned } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const adminEmail = (process.env.ADMIN_EMAIL || "gyan123priya@gmail.com").trim().toLowerCase();
    if (user.email && user.email.trim().toLowerCase() === adminEmail) {
      return res.status(400).json({ success: false, message: "Cannot ban Super Admin" });
    }

    user.isBanned = typeof isBanned === "boolean" ? isBanned : !user.isBanned;
    await user.save();

    const io = req.app.get("io");
    if (io) {
      if (user.isBanned) {
        io.emit("user:banned", { userId: user._id.toString(), message: "Your account has been banned by Admin." });
      } else {
        io.emit("user:unbanned", { userId: user._id.toString(), message: "Your account has been unbanned by Admin." });
      }
    }

    return res.status(200).json({
      success: true,
      message: `User ${user.isBanned ? "banned" : "unbanned"} successfully`,
      isBanned: user.isBanned,
      user,
    });
  } catch (error) {
    console.error("❌ toggleUserBan error:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
