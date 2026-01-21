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
        dailyLimit: { type: Number, default: 10 },
        dailyExp: { type: Number, default: 10 },
        lastReset: { type: Date, default: Date.now },
      },

      stayInRoom: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        dailyLimit: { type: Number, default: 300 },
        minPerReward: { type: Number, default: 5 },
        expPerReward: { type: Number, default: 10 },
        lastReset: { type: Date, default: Date.now },

        roomDurations: [
          {
            roomId: { type: String },
            duration: { type: Number },
            expEarned: { type: Number },
            date: { type: Date },
          },
        ],
      },

      sendGift: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        noLimit: { type: Boolean, default: true },

        expPerGift: {
          coins: { type: Number, default: 1 },
          diamonds: { type: Number, default: 10 },
        },

        lastUpdate: { type: Date, default: Date.now },
      },

      buyStoreGoods: {
        count: { type: Number, default: 0 },
        totalExp: { type: Number, default: 0 },
        noLimit: { type: Boolean, default: true },
        expPer25Coins: { type: Number, default: 1 },
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
  { timestamps: true },
);

// Indexes
levelSchema.index({ userId: 1 });
levelSchema.index({ "personal.currentLevel": -1 });
levelSchema.index({ "personal.totalExp": -1 });

module.exports = mongoose.model("Level", levelSchema);
