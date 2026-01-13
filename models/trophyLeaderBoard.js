const mongoose = require("mongoose");

const leaderboardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    username: String,
    avatar: String,
    
    // Daily Stats
    daily: {
      coins: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalValue: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
    },
    
    // Weekly Stats
    weekly: {
      coins: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalValue: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
    },
    
    // Monthly Stats
    monthly: {
      coins: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalValue: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
    },
    
    // Overall Stats
    allTime: {
      coins: { type: Number, default: 0 },
      giftsReceived: { type: Number, default: 0 },
      totalValue: { type: Number, default: 0 },
    },
    
    // Rank tracking
    rank: {
      daily: { type: Number, default: 0 },
      weekly: { type: Number, default: 0 },
      monthly: { type: Number, default: 0 },
      allTime: { type: Number, default: 0 },
    },
    
    // Badge/Achievement system
    badges: [
      {
        badgeId: String,
        badgeName: String,
        unlockedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

// Indexes for leaderboard queries
leaderboardSchema.index({ "daily.coins": -1, "daily.lastUpdated": -1 });
leaderboardSchema.index({ "weekly.coins": -1, "weekly.lastUpdated": -1 });
leaderboardSchema.index({ "monthly.coins": -1, "monthly.lastUpdated": -1 });
leaderboardSchema.index({ "allTime.coins": -1 });
leaderboardSchema.index({ userId: 1 });

module.exports = mongoose.model("Leaderboard", leaderboardSchema);
