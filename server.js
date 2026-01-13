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
  maxHttpBufferSize: 10 * 1024 * 1024, // ← ADD THIS LINE
  transports: ["websocket", "polling"],
});

require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);

// Load gift socket events (no conflict - separate namespace)
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);

// ✅ Make io globally available
global.io = io;
console.log("🚀 Socket.IO initialized successfully");

/* ===================== START SERVER ===================== */
const { startCronJobs } = require("./utils/cron");
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready on port ${PORT}`);
  startCronJobs();
});
module.exports = { app, io, server };
