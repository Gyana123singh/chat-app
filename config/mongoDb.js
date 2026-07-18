const mongoose = require("mongoose");
const User = require("../models/users");
const StoreCategory = require("../models/storeCategory");
const bcrypt = require("bcryptjs");
const generateDisplayId = require("../utils/generateDisplayId");

const seedStoreCategories = async () => {
  try {
    const defaultCategories = ["ENTRANCE", "FRAME", "RING", "BUBBLE", "THEME", "EMOJI"];
    for (const type of defaultCategories) {
      const exists = await StoreCategory.findOne({ type });
      if (!exists) {
        await StoreCategory.create({ type });
        console.log(`🌱 Store category seeded: ${type}`);
      }
    }
  } catch (error) {
    console.error("❌ Seeding store categories failed:", error);
  }
};

const seedAdminUser = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || "gyan123priya@gmail.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Gyan@1234";

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      console.log("🌱 Admin user not found. Seeding admin user...");
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      const displayId = await generateDisplayId();

      await User.create({
        username: "Admin",
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        displayId,
      });
      console.log("✅ Admin user seeded successfully!");
    } else {
      // Ensure the existing admin has the 'admin' role and a password
      let updated = false;
      if (existingAdmin.role !== "admin") {
        existingAdmin.role = "admin";
        updated = true;
      }
      
      // We must fetch password since select: false might hide it, but wait:
      // existingAdmin was fetched without "+password". Let's check if they have password by querying with +password
      const adminWithPwd = await User.findById(existingAdmin._id).select("+password");
      if (!adminWithPwd.password) {
        console.log("🔑 Existing admin has no password. Setting default password...");
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        existingAdmin.password = hashedPassword;
        updated = true;
      }

      if (updated) {
        await existingAdmin.save();
        console.log("⚙️ Existing admin user updated");
      } else {
        console.log("ℹ️ Admin user already exists");
      }
    }
  } catch (error) {
    console.error("❌ Seeding admin user failed:", error);
  }
};

const connectMongose = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      family: 4,
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
    });

    console.log("✅ MongoDB connected successfully");
    await seedAdminUser();
    await seedStoreCategories();
  } catch (error) {
    console.error("❌ MongoDB connection failed:");
    console.error(error);
  }
};

module.exports = { connectMongose };
