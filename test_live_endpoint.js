const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("./models/users");

const JWT_SECRET = "b47e3c0f9a2c4ef1d8937a5c0f14e7aa3d8bcf2e91f44db97c6e5a1d2f8bd73c4fc29e8a7d13fb629c8df3a17ed5b09ea47df93c51ab8e6c4bf270f9d1c3a728";

async function test() {
  await mongoose.connect("mongodb+srv://gyan123priya_db_user:AbBHFubnmCTXzpgx@cluster0.qiu7h2r.mongodb.net/?appName=Cluster0");
  console.log("Connected to MongoDB");

  const users = await User.find({}).limit(2);
  if (users.length < 2) {
    console.log("Not enough users");
    process.exit(1);
  }

  const userA = users[0];
  const userB = users[1];

  console.log(`User A (Logged In): id=${userA._id}, username=${userA.username}`);
  console.log(`User B (Target): id=${userB._id}, username=${userB.username}`);

  // Generate JWT token for User A
  const token = jwt.sign(
    {
      sub: userA._id.toString(),
      email: userA.email,
      name: userA.username,
      phone: userA.phone,
      role: userA.role || "user"
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  try {
    const res = await axios.get(`https://api.dilvoicechat.fun/api/users/profile-details/${userB._id.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    console.log("Response username:", res.data?.data?.username);
    console.log("Response id:", res.data?.data?.id);
  } catch (err) {
    console.error("HTTP Request failed:", err.response?.data || err.message);
  }

  mongoose.disconnect();
}

test();
