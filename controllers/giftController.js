const cloudinary = require("../config/cloudinary");
const User = require("../models/users");
const Gift = require("../models/gift");
const Category = require("../models/category");

exports.addGift = async (req, res) => {
  try {
    const { name, price, category } = req.body;

    // ❌ Validation
    if (!name || !price || !category || !req.file) {
      return res.status(400).json({
        success: false,
        message: "Name, price, category and image are required",
      });
    }

    // ✅ Upload image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: "gifts",
      resource_type: "image",
    });

    // ✅ Save gift
    const gift = await Gift.create({
      name,
      price,
      category,

      // 🔥 IMPORTANT PART
      giftImage: uploadResult.secure_url, // ✅ MAIN IMAGE
      cloudinaryId: uploadResult.public_id,

      mediaType: uploadResult.format === "gif" ? "gif" : "image",
    });

    return res.status(201).json({
      success: true,
      message: "Gift added successfully",
      gift,
    });
  } catch (error) {
    console.error("Add Gift Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { name } = req.body;

    // ✅ Validation
    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Category name is required",
      });
    }

    // ✅ Check duplicate
    const exists = await Category.findOne({ name: name.trim() });
    if (exists) {
      return res.status(409).json({
        message: "Category already exists",
      });
    }

    // ✅ Create category
    const category = await Category.create({
      name: name.trim(),
    });

    return res.status(201).json({
      message: "Category added successfully",
      category,
    });
  } catch (error) {
    console.error("Add Category Error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
exports.getCategory = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 }); // ✅ OLD → NEW (new data at bottom)

    return res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get Category Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.getAllGifts = async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;

    let query = { isActive: true }; // ✅ FIXED

    if (category) {
      query.category = category;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const gifts = await Gift.find(query)
      .sort({ createdAt: -1 }) // rarity sort optional
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Gift.countDocuments(query);

    res.status(200).json({
      success: true,
      gifts,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get All Gifts Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gifts",
    });
  }
};
exports.checkEligibility = async (req, res) => {
  try {
    const { giftId, recipientId } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found", eligible: false });
    }

    const gift = await Gift.findOne({ giftId, isActive: true });
    if (!gift) {
      return res
        .status(404)
        .json({ success: false, message: "Gift not found", eligible: false });
    }

    const eligible = user.coinBalance >= gift.coinCost;

    return res.json({
      success: true,
      eligible,
      userCoins: user.coinBalance,
      giftCost: gift.coinCost,
      giftName: gift.giftName,
      message: eligible
        ? "Sufficient balance"
        : `Need ${gift.coinCost - user.coinBalance} more coins`,
    });
  } catch (error) {
    next(error);
  }
};

// Get all gifts
// app.get('/api/gifts/all', async (req, res, next) => {
//   try {
//     const { category } = req.query;
//     const filter = { isActive: true };
//     if (category) filter.category = category;

//     const gifts = await Gift.find(filter).sort({ createdAt: -1 });
//     return res.json({ success: true, gifts });
//   } catch (error) {
//     next(error);
//   }
// });
// Send gift
exports.sendGift = async (req, res) => {
  try {
    const { giftId, recipientId } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const gift = await Gift.findOne({ giftId, isActive: true });
    if (!gift) {
      return res
        .status(404)
        .json({ success: false, message: "Gift not found" });
    }

    if (user.coinBalance < gift.coinCost) {
      return res.status(400).json({
        success: false,
        message: "Insufficient coin balance",
        required: gift.coinCost,
        available: user.coinBalance,
      });
    }

    user.coinBalance -= gift.coinCost;
    user.totalSpent += gift.coinCost;
    await user.save();

    const transaction = new Transaction({
      transactionId: uuidv4(),
      userId,
      type: "GIFT_SEND",
      giftId: gift._id,
      giftName: gift.giftName,
      recipientId,
      coinsUsed: gift.coinCost,
      status: "SUCCESS",
    });
    await transaction.save();

    return res.json({
      success: true,
      message: "Gift sent successfully",
      transactionId: transaction.transactionId,
      remainingCoins: user.coinBalance,
      giftName: gift.giftName,
    });
  } catch (error) {
    next(error);
  }
};

// // controllers/giftController.js
// const Gift = require('../models/Gift');
// const Transaction = require('../models/Transaction');
// const User = require('../models/User');

// exports.getAllGifts = async (req, res) => {
//   try {
//     const { category, page = 1, limit = 20 } = req.query;

//     let query = { isAvailable: true };

//     if (category) {
//       query.category = category;
//     }

//     const skip = (page - 1) * limit;

//     const gifts = await Gift.find(query)
//       .sort({ rarity: -1, createdAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await Gift.countDocuments(query);

//     res.status(200).json({
//       success: true,
//       gifts,
//       pagination: {
//         total,
//         page: parseInt(page),
//         pages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch gifts',
//       error: error.message,
//     });
//   }
// };

// exports.sendGift = async (req, res) => {
//   try {
//     const { giftId, receiverId, roomId, message } = req.body;

//     if (!giftId || !receiverId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Gift ID and receiver ID are required',
//       });
//     }

//     if (receiverId === req.user.id) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot send gift to yourself',
//       });
//     }

//     const gift = await Gift.findById(giftId);
//     const sender = await User.findById(req.user.id);
//     const receiver = await User.findById(receiverId);

//     if (!gift || !receiver) {
//       return res.status(404).json({
//         success: false,
//         message: 'Gift or receiver not found',
//       });
//     }

//     if (sender.stats.coins < gift.price) {
//       return res.status(400).json({
//         success: false,
//         message: 'Insufficient coins',
//       });
//     }

//     // Deduct coins from sender
//     sender.stats.coins -= gift.price;
//     await sender.save();

//     // Add to receiver
//     receiver.stats.coins += Math.ceil(gift.price * 0.8); // Platform takes 20%
//     receiver.stats.giftsReceived += 1;
//     await receiver.save();

//     // Create transaction
//     const transaction = new Transaction({
//       sender: req.user.id,
//       receiver: receiverId,
//       gift: giftId,
//       room: roomId || null,
//       amount: gift.price,
//       transactionType: 'gift',
//       status: 'completed',
//       message: message || '',
//     });

//     await transaction.save();
//     await transaction.populate('sender receiver gift', 'username profile.avatar name');

//     res.status(201).json({
//       success: true,
//       message: 'Gift sent successfully',
//       transaction,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to send gift',
//       error: error.message,
//     });
//   }
// };

// exports.getGiftHistory = async (req, res) => {
//   try {
//     const { page = 1, limit = 20 } = req.query;
//     const skip = (page - 1) * limit;

//     const transactions = await Transaction.find({
//       $or: [{ sender: req.user.id }, { receiver: req.user.id }],
//     })
//       .populate('sender receiver gift', 'username profile.avatar name')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await Transaction.countDocuments({
//       $or: [{ sender: req.user.id }, { receiver: req.user.id }],
//     });

//     res.status(200).json({
//       success: true,
//       transactions,
//       pagination: {
//         total,
//         page: parseInt(page),
//         pages: Math.ceil(total / limit),
//       },
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch history',
//       error: error.message,
//     });
//   }
// };

// exports.getLeaderboard = async (req, res) => {
//   try {
//     const { timeRange = '7d' } = req.query;

//     let dateFilter = new Date();
//     if (timeRange === '24h') {
//       dateFilter.setHours(dateFilter.getHours() - 24);
//     } else if (timeRange === '7d') {
//       dateFilter.setDate(dateFilter.getDate() - 7);
//     } else if (timeRange === '30d') {
//       dateFilter.setDate(dateFilter.getDate() - 30);
//     }

//     const transactions = await Transaction.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: dateFilter },
//           transactionType: 'gift',
//         },
//       },
//       {
//         $group: {
//           _id: '$receiver',
//           totalGifts: { $sum: 1 },
//           totalValue: { $sum: '$amount' },
//         },
//       },
//       {
//         $sort: { totalValue: -1 },
//       },
//       {
//         $limit: 20,
//       },
//       {
//         $lookup: {
//           from: 'users',
//           localField: '_id',
//           foreignField: '_id',
//           as: 'user',
//         },
//       },
//     ]);

//     const leaderboard = transactions.map((entry) => ({
//       rank: transactions.indexOf(entry) + 1,
//       user: entry.user[0],
//       totalGifts: entry.totalGifts,
//       totalValue: entry.totalValue,
//     }));

//     res.status(200).json({
//       success: true,
//       timeRange,
//       leaderboard,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch leaderboard',
//       error: error.message,
//     });
//   }
// };
