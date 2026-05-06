const mongoose = require("mongoose");

const connectMongose = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      family: 4,
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
    });

    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:");
    console.error(error);
  }
};

module.exports = { connectMongose };
