const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const passport = require("passport");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs-extra");
const path = require("path");

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
const privateChatRouter = require("./router/privateChatRouter");
const trophyRouter = require("./router/trophyRouter");

const MusicState = require("./models/musicState");

const app = express();
connectMongose();

const PORT = process.env.PORT || 5001;

/* ===================== MIDDLEWARE ===================== */
app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret123",
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
app.use("/api/private-chat", privateChatRouter);
app.use("/api/trophies", trophyRouter);

app.get("/", (req, res) => {
  res.send("API is running...");
});

/* ===================== SOCKET ===================== */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 100 * 1024 * 1024,
});

app.set("io", io);

/* ===================== UPLOAD ROOT ===================== */
const uploadDir = path.resolve(process.cwd(), "uploads");
fs.ensureDirSync(uploadDir);

/* ===================== MUSIC ROUTES ===================== */
const musicRouter = require("./router/musicRouter")(io);
app.use("/api/music", musicRouter);

/* ===================== AUDIO STREAM ===================== */
app.get("/stream/:roomId/:filename", (req, res) => {
  const filePath = path.resolve(
    process.cwd(),
    "uploads",
    req.params.roomId,
    req.params.filename
  );

  if (!fs.existsSync(filePath)) return res.sendStatus(404);

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "audio/mpeg",
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "audio/mpeg",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/* ===================== VIDEO ===================== */
const videoRouter = require("./router/videoRouter")(io);
app.use("/api/video", videoRouter);

app.get("/video-stream/:roomId/:filename", (req, res) => {
  const filePath = path.resolve(
    process.cwd(),
    "uploads",
    "videos",
    req.params.roomId,
    req.params.filename
  );

  if (!fs.existsSync(filePath)) return res.sendStatus(404);

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "video/mp4",
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/* ===================== SOCKET EVENTS ===================== */
require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);
require("./utils/giftSocketEvents")(io);
require("./utils/socketEventPrivateChat")(io);

global.io = io;

console.log("🚀 Socket.IO + Music Streaming ready");

/* ===================== CRON ===================== */
const cron = require("./utils/cron");
let cronInstance = null;

/* ===================== START ===================== */
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  cronInstance = cron;
  cronInstance.startCronJobs();
});

/* ===================== SHUTDOWN ===================== */
const gracefulShutdown = () => {
  console.log("🛑 Server shutting down...");
  if (cronInstance?.stopCronJobs) cronInstance.stopCronJobs();
  server.close(() => process.exit(0));
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("SIGQUIT", gracefulShutdown);

module.exports = { app, io, server };
