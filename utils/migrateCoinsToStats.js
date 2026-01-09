const mongoose = require("mongoose");
const User = require("../models/users");

// database/migrations/migrateCoinsToStats.js

/**
 * 🔥 MIGRATION SCRIPT
 * Purpose: Consolidate User.coins → User.stats.coins
 * Run once, then remove User.coins field from schema
 */

async function migrateCoinsToStats() {
  try {
    console.log("🔄 Starting coin migration...");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    // Find all users with coins field
    const usersWithCoins = await User.find({
      coins: { $exists: true, $ne: null },
    });
    console.log(`📊 Found ${usersWithCoins.length} users with coins field`);

    // Migrate each user
    let migrated = 0;
    let errors = 0;

    for (const user of usersWithCoins) {
      try {
        // If stats.coins doesn't exist, use coins value
        if (!user.stats.coins) {
          user.stats.coins = user.coins;
        } else {
          // If both exist, use maximum value (safety check)
          user.stats.coins = Math.max(user.stats.coins, user.coins);
        }

        await user.save();
        migrated++;
      } catch (error) {
        console.error(`❌ Error migrating user ${user._id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   - Migrated: ${migrated} users`);
    console.log(`   - Errors: ${errors} users`);

    // Verify migration
    const verifyUsers = await User.find({ "stats.coins": { $exists: true } });
    console.log(
      `\n📊 Verification: ${verifyUsers.length} users have stats.coins`
    );

    // Summary statistics
    const totalCoins = await User.aggregate([
      {
        $group: {
          _id: null,
          totalCoins: { $sum: "$stats.coins" },
          avgCoins: { $avg: "$stats.coins" },
          maxCoins: { $max: "$stats.coins" },
          minCoins: { $min: "$stats.coins" },
        },
      },
    ]);

    if (totalCoins.length > 0) {
      console.log(`\n💰 Statistics:`);
      console.log(`   - Total coins in system: ${totalCoins.totalCoins}`);
      console.log(`   - Average per user: ${totalCoins.avgCoins.toFixed(2)}`);
      console.log(`   - Max: ${totalCoins.maxCoins}`);
      console.log(`   - Min: ${totalCoins.minCoins}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

async function verifyMigration() {
  try {
    console.log("🔍 Verifying migration...\n");

    await mongoose.connect(process.env.MONGODB_URI);

    // Check for any users with negative coins
    const negativeCoins = await User.find({ "stats.coins": { $lt: 0 } });
    if (negativeCoins.length > 0) {
      console.warn(
        `⚠️  WARNING: ${negativeCoins.length} users with negative coins!`
      );
      negativeCoins.forEach((u) => {
        console.warn(`   - ${u.username}: ${u.stats.coins} coins`);
      });
    } else {
      console.log("✅ No users with negative coins");
    }

    // Check for data type mismatches
    const invalidCoins = await User.find({
      "stats.coins": { $not: { $type: "number" } },
    });
    if (invalidCoins.length > 0) {
      console.warn(
        `⚠️  WARNING: ${invalidCoins.length} users with invalid coin types!`
      );
    } else {
      console.log("✅ All coin values are numbers");
    }

    // Check for missing stats.coins
    const missingCoins = await User.find({
      $or: [{ "stats.coins": { $exists: false } }, { "stats.coins": null }],
    });
    if (missingCoins.length > 0) {
      console.warn(
        `⚠️  WARNING: ${missingCoins.length} users missing stats.coins!`
      );
    } else {
      console.log("✅ All users have stats.coins field");
    }

    console.log("\n✅ Verification complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    process.exit(1);
  }
}

// Run migration or verification based on command line argument
if (require.main === module) {
  if (process.argv === "--verify") {
    verifyMigration();
  } else {
    migrateCoinsToStats();
  }
}

module.exports = { migrateCoinsToStats, verifyMigration };
