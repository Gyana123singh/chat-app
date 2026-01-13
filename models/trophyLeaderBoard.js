const mongoose = require("mongoose");

const leaderboardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    username: {
      type: String,
      default: "Unknown",
    },
    avatar: {
      type: String,
      default: null,
    },

    // 📊 Daily Stats
    daily: {
      coins: {
        type: Number,
        default: 0,
      },
      giftsReceived: {
        type: Number,
        default: 0,
      },
      totalValue: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: null,
      },
    },

    // 📊 Weekly Stats
    weekly: {
      coins: {
        type: Number,
        default: 0,
      },
      giftsReceived: {
        type: Number,
        default: 0,
      },
      totalValue: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: null,
      },
    },

    // 📊 Monthly Stats
    monthly: {
      coins: {
        type: Number,
        default: 0,
      },
      giftsReceived: {
        type: Number,
        default: 0,
      },
      totalValue: {
        type: Number,
        default: 0,
      },
      lastUpdated: {
        type: Date,
        default: null,
      },
    },

    // 📊 All-Time Stats
    allTime: {
      coins: {
        type: Number,
        default: 0,
      },
      giftsReceived: {
        type: Number,
        default: 0,
      },
      totalValue: {
        type: Number,
        default: 0,
      },
    },

    // 🏆 Rankings
    rank: {
      daily: {
        type: Number,
        default: 0,
      },
      weekly: {
        type: Number,
        default: 0,
      },
      monthly: {
        type: Number,
        default: 0,
      },
      allTime: {
        type: Number,
        default: 0,
      },
    },

    // 🎖️ User Level & Streak
    level: {
      type: Number,
      enum: [1, 2, 3, 4],
      default: 1,
      // 1 = Bronze (0 - 1999 coins)
      // 2 = Silver (2000 - 4999 coins)
      // 3 = Gold (5000 - 9999 coins)
      // 4 = Platinum (10000+ coins)
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },

    // 🎯 Badges & Achievements
    badges: [
      {
        name: String,
        icon: String,
        unlockedAt: Date,
      },
    ],

    // 📝 Metadata
    lastContributionDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// 🔍 Index for efficient queries
leaderboardSchema.index({ "daily.coins": -1 });
leaderboardSchema.index({ "weekly.coins": -1 });
leaderboardSchema.index({ "monthly.coins": -1 });
leaderboardSchema.index({ "allTime.coins": -1 });
leaderboardSchema.index({ userId: 1 });

module.exports = mongoose.model("Leaderboard", leaderboardSchema);