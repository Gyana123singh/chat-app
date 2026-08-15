const StoreGiftInventory = require("../models/storeGiftInventory");
const User = require("../models/users");

async function expireStoreGifts() {
  try {
    const now = new Date();

    const expiredGifts = await StoreGiftInventory.find({
      expiresAt: { $lte: now },
      isActive: true,
    });

    if (!expiredGifts.length) return;

    console.log(`⌛ Expiring ${expiredGifts.length} store gifts`);

    for (const gift of expiredGifts) {
      gift.isActive = false;
      await gift.save();

      const update = {};

      if (gift.effectType === "FRAME") update["profile.frame"] = null;
      if (gift.effectType === "RING") update["profile.ring"] = null;
      if (gift.effectType === "BUBBLE") update["profile.bubble"] = null;
      if (gift.effectType === "ENTRANCE")
        update["profile.entranceEffect"] = null;
      if (gift.effectType === "THEME") {
        update["profile.theme"] = null;
        update["profile.themeUrl"] = null;
      }

      if (Object.keys(update).length > 0) {
        await User.findByIdAndUpdate(gift.userId, { $set: update });
      }
    }
  } catch (err) {
    console.error("❌ Store gift expiry worker error:", err);
  }
}

module.exports = expireStoreGifts;
