const mongoose = require("mongoose");

const levelSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Personal Level Stats
    personal: {
      currentLevel: { type: Number, default: 1 },
      currentExp: { type: Number, default: 0 },
      totalExp: { type: Number, default: 0 },
      expToNextLevel: { type: Number, default: 700 }, // EXP needed for next level
      expProgress: { type: Number, default: 0 }, // Current progress towards next level
      lastUpdated: { type: Date, default: Date.now },
    },

    // Room Level Stats (Host only)
    room: {
      currentLevel: { type: Number, default: 1 },
      currentExp: { type: Number, default: 0 },
      totalExp: { type: Number, default: 0 },
      expToNextLevel: { type: Number, default: 500 },
      expProgress: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
    },

    // Experience Sources Tracking (daily limits)
    expSources: {
      playLudo: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        dailyLimit: 10, // max rounds per day
        dailyExp: 10, // EXP per round
        lastReset: { type: Date, default: Date.now },
      },

      stayInRoom: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        dailyLimit: 300, // max 300 minutes per day (5 hours)
        minPerReward: 5, // reward every 5 minutes
        expPerReward: 10, // EXP per 5 minutes
        lastReset: { type: Date, default: Date.now },
        roomDurations: [
          {
            roomId: String,
            duration: Number, // in minutes
            expEarned: Number,
            date: Date,
          },
        ],
      },

      sendGift: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        noLimit: true, // No daily limit
        expPerGift: {
          coins: 1, // 25 coins gift = 1 EXP
          diamonds: 10, // 2000 diamonds = 10 EXP
        },
        lastUpdate: { type: Date, default: Date.now },
      },

      buyStoreGoods: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        noLimit: true,
        expPer25Coins: 1, // 1 EXP per 25 coins spent
        lastUpdate: { type: Date, default: Date.now },
      },
    },

    // Level Benefits Unlocked
    benefits: [
      {
        benefitId: String,
        benefitName: String,
        level: Number,
        description: String,
        icon: String,
        unlockedAt: Date,
      },
    ],

    // Level Rewards
    levelUpRewards: [
      {
        level: Number,
        reward: String,
        rewardType: String, // "badge", "coins", "diamonds", "feature"
        rewardValue: Number,
        claimed: { type: Boolean, default: false },
        claimedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

// Indexes
levelSchema.index({ userId: 1 });
levelSchema.index({ "personal.currentLevel": -1 });
levelSchema.index({ "personal.totalExp": -1 });

module.exports = mongoose.model("Level", levelSchema);
