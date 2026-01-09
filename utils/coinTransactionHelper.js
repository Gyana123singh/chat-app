// utils/coinTransactionHelper.js - ATOMIC COIN OPERATIONS
const mongoose = require("mongoose");
const User = require("../models/users");
const GiftTransaction = require("../models/giftTransaction");

/**
 * 🔥 ATOMIC COIN TRANSFER - SAFE FROM RACE CONDITIONS
 * Uses MongoDB transactions for consistency
 */
class CoinTransactionHelper {
  /**
   * Atomically deduct coins from sender and add to multiple recipients
   * @param {string} senderId - Sender user ID
   * @param {Array<string>} recipientIds - Array of recipient user IDs
   * @param {number} coinsPerRecipient - Coins per recipient
   * @param {Object} giftData - Gift metadata
   * @param {string} roomId - Room ID
   * @returns {Object} Transaction result with IDs
   */
  static async transferCoins({
    senderId,
    recipientIds,
    coinsPerRecipient,
    giftData,
    roomId,
  }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const totalCoinsRequired = coinsPerRecipient * recipientIds.length;

      // ✅ Step 1: Deduct from sender (atomic)
      const senderUpdate = await User.findByIdAndUpdate(
        senderId,
        {
          $inc: { "stats.coins": -totalCoinsRequired },
        },
        {
          new: true,
          session,
        }
      );

      // ✅ Validate sender has enough coins (must happen in transaction)
      if (!senderUpdate || senderUpdate.stats.coins < 0) {
        throw new Error("Insufficient coins after deduction");
      }

      // ✅ Step 2: Add coins to all recipients (atomic)
      const recipientUpdateResult = await User.updateMany(
        { _id: { $in: recipientIds } },
        {
          $inc: { "stats.coins": coinsPerRecipient },
        },
        {
          session,
        }
      );

      if (recipientUpdateResult.modifiedCount !== recipientIds.length) {
        throw new Error(
          `Failed to update all recipients. Expected: ${recipientIds.length}, Got: ${recipientUpdateResult.modifiedCount}`
        );
      }

      // ✅ Step 3: Create GiftTransaction record (atomic)
      const transaction = await GiftTransaction.create(
        [
          {
            roomId,
            senderId,
            receiverId: recipientIds, // Primary recipient
            giftId: giftData.giftId,
            giftName: giftData.giftName,
            giftIcon: giftData.giftIcon,
            giftPrice: giftData.giftPrice,
            giftCategory: giftData.giftCategory,
            giftRarity: giftData.giftRarity,
            sendType: giftData.sendType,
            totalCoinsDeducted: totalCoinsRequired,
            recipientCount: recipientIds.length,
            recipientIds: recipientIds,
            status: "completed",
          },
        ],
        { session }
      );

      // ✅ Commit transaction
      await session.commitTransaction();

      return {
        success: true,
        transactionId: transaction._id,
        senderNewBalance: senderUpdate.stats.coins,
        totalCoinsDeducted: totalCoinsRequired,
        recipientsUpdated: recipientIds.length,
      };
    } catch (error) {
      // ❌ Rollback on any error
      await session.abortTransaction();
      throw new Error(`Coin transfer failed: ${error.message}`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Check sender balance before attempting transfer
   * @param {string} senderId - Sender user ID
   * @param {number} totalCoinsRequired - Total coins needed
   * @returns {Object} Balance check result
   */
  static async validateBalance(senderId, totalCoinsRequired) {
    const sender = await User.findById(senderId).select("stats.coins");

    if (!sender) {
      return {
        valid: false,
        message: "Sender not found",
        senderCoins: 0,
        required: totalCoinsRequired,
      };
    }

    const hasEnoughCoins = sender.stats.coins >= totalCoinsRequired;

    return {
      valid: hasEnoughCoins,
      message: hasEnoughCoins
        ? "Sufficient balance"
        : `Insufficient coins. Required: ${totalCoinsRequired}, Available: ${sender.stats.coins}`,
      senderCoins: sender.stats.coins,
      required: totalCoinsRequired,
    };
  }

  /**
   * Get user's current coin balance
   * @param {string} userId - User ID
   * @returns {number} Current coin balance
   */
  static async getUserBalance(userId) {
    const user = await User.findById(userId).select("stats.coins");
    return user?.stats.coins ?? 0;
  }

  /**
   * Safely increment coins for bonus/reward
   * @param {string} userId - User ID
   * @param {number} coins - Coins to add
   * @returns {number} New balance
   */
  static async addCoins(userId, coins) {
    if (coins < 0) {
      throw new Error("Cannot add negative coins. Use deductCoins instead.");
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { "stats.coins": coins } },
      { new: true }
    ).select("stats.coins");

    return updated?.stats.coins ?? 0;
  }

  /**
   * Safely deduct coins (prevents negative balance)
   * @param {string} userId - User ID
   * @param {number} coins - Coins to deduct
   * @returns {Object} Deduction result
   */
  static async deductCoins(userId, coins) {
    if (coins < 0) {
      throw new Error("Cannot deduct negative coins. Use addCoins instead.");
    }

    const user = await User.findById(userId).select("stats.coins");
    if (!user) {
      throw new Error("User not found");
    }

    if (user.stats.coins < coins) {
      throw new Error(
        `Insufficient coins. Required: ${coins}, Available: ${user.stats.coins}`
      );
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { "stats.coins": -coins } },
      { new: true }
    ).select("stats.coins");

    return {
      success: true,
      newBalance: updated.stats.coins,
      coinsDeducted: coins,
    };
  }
}

module.exports = CoinTransactionHelper;
