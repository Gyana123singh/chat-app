const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");

dotenv.config();
require("./config/passport");

const { connectMongose } = require("./config/mongoDb");
const authRoutes = require("./router/authRouter");
const adminRoutes = require("./router/adminRouter");
const usersRouter = require("./router/usersRouter");
const roomsRouter = require("./router/roomsRouter");
const firebaseOtpRouter = require("./router/authFirebaseRouter");
const giftRouter = require("./router/giftsRouter");
const friendRequestRouter = require("./router/friendRequestRouter");
const blockUsersRouter = require("./router/blockUsersRouter");
const profileVisitRouter = require("./router/profileVisitRouter");
const paymentRouter = require("./router/paymentRouter");
const storeGiftRouter = require("./router/storeGiftRouter");
const sendStoreGiftRoutes = require("./router/sendStoreGiftRoutes");
const musicRouter = require("./router/musicRouter");
const privateChatRouter = require("./router/privateChatRouter");
const trophyRouter = require("./router/trophyRouter");

const app = express();
connectMongose();

const PORT = process.env.PORT || 5001;

/* ===================== MIDDLEWARE ===================== */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

/* 🔥 REQUIRED */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "secret123",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());

/* ===================== ROUTES ===================== */

app.use("/auth", authRoutes);
app.use("/api", adminRoutes);
app.use("/api/users", usersRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/auth/otp", firebaseOtpRouter);
app.use("/api/gift", giftRouter);
app.use("/api/friends", friendRequestRouter);
app.use("/api/block", blockUsersRouter);
app.use("/api/profile-visits", profileVisitRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/store-gifts", storeGiftRouter);
app.use("/api/store-gift-send", sendStoreGiftRoutes);
app.use("/api/music", musicRouter);
app.use("/api/private-chat", privateChatRouter);
app.use("/api/trophies", trophyRouter);

app.get("/", (req, res) => {
  res.send("API is running...");
});

/* ===================== SOCKET SETUP ===================== */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 10 * 1024 * 1024,
  transports: ["websocket", "polling"],
});

require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);

// ✅ Make io globally available
global.io = io;
console.log("🚀 Socket.IO initialized successfully");

/* ===================== CRON IMPORT ===================== */
const cron = require("./utils/cron"); // ✅ FULL MODULE IMPORT (start + stop)
let cronInstance = null;

/* ===================== START SERVER ===================== */
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready on port ${PORT}`);

  // ✅ START CRON JOBS
  cronInstance = cron;
  cronInstance.startCronJobs();
  console.log("🕐 Cron jobs initialized ✅");
});

module.exports = { app, io, server };

/* ===================== GRACEFUL SHUTDOWN ===================== */
const gracefulShutdown = (signal) => {
  console.log(`🛑 Received ${signal}. Shutting down gracefully...`);

  // ✅ STOP CRON JOBS FIRST
  if (cronInstance && cronInstance.stopCronJobs) {
    cronInstance.stopCronJobs();
    console.log("🛑 All cron jobs stopped");
  }

  // ✅ CLOSE SERVER
  server.close((err) => {
    if (err) {
      console.error("❌ Server close error:", err);
      process.exit(1);
    }
    console.log("✅ Server closed cleanly");
    process.exit(0);
  });

  // Force close after 10 seconds if not clean
  setTimeout(() => {
    console.error("⚠️ Force closing server after timeout");
    process.exit(1);
  }, 10000);
};

// ✅ LISTEN FOR SHUTDOWN SIGNALS
process.on("SIGINT", gracefulShutdown); // Ctrl+C
process.on("SIGTERM", gracefulShutdown); // Docker/PM2/Heroku
process.on("SIGQUIT", gracefulShutdown); // Kill -3
