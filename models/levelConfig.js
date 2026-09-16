const mongoose = require("mongoose");

const defaultPersonalExp = {
  1: 50,
  2: 80,
  3: 120,
  4: 200,
  5: 350,
  6: 500,
  7: 700,
  8: 1000,
  9: 1500,
  10: 2200,
  11: 3000,
  12: 4000,
  13: 5500,
  14: 7500,
  15: 10000,
};

const defaultRoomExp = {
  0: 39,
  1: 80,
  2: 150,
  3: 260,
  4: 400,
  5: 600,
  6: 900,
  7: 1300,
  8: 1800,
  9: 2500,
};

const defaultPersonalBadges = {
  1: "⭐",
  5: "🌙",
  10: "👑",
  20: "🔥",
  30: "💎",
  40: "🏆",
};

const defaultPersonalBenefits = {
  1: { headwear: true },
  2: { canCreateRoom: true },
  5: { unlimitedPhoto: true },
};

const defaultRoomBenefits = {
  1: { roomPassword: true },
  2: { adminLimit: 2 },
  3: { adminLimit: 5 },
  5: { micLimit: 10 },
  7: { adminLimit: 10 },
  9: { theme: true },
};

const defaultTrophyThresholds = {
  1: 0,
  2: 2000,
  3: 5000,
  4: 10000,
};

const levelConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    personal: {
      expPerInterval: { type: Number, default: 10 },
      stayIntervalMinutes: { type: Number, default: 5 },
      dailyLimit: { type: Number, default: 300 },
      expTable: { type: Map, of: Number, default: defaultPersonalExp },
      badges: { type: Map, of: String, default: defaultPersonalBadges },
      benefits: { type: Map, of: mongoose.Schema.Types.Mixed, default: defaultPersonalBenefits },
    },
    room: {
      expPerMicInterval: { type: Number, default: 20 },
      micIntervalMinutes: { type: Number, default: 10 },
      pkWinExp: { type: Number, default: 100 },
      pkLoseExp: { type: Number, default: 20 },
      pkDrawExp: { type: Number, default: 50 },
      pkMvpExp: { type: Number, default: 50 },
      expTable: { type: Map, of: Number, default: defaultRoomExp },
      benefits: { type: Map, of: mongoose.Schema.Types.Mixed, default: defaultRoomBenefits },
    },
    trophy: {
      thresholds: { type: Map, of: Number, default: defaultTrophyThresholds },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LevelConfig", levelConfigSchema);
