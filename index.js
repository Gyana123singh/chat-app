const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require("express-session");
const http = require("http"); // ✅ FIX 1
const { Server } = require("socket.io"); // ✅ Best practice

dotenv.config();
require("./config/passport");

const { connectMongose } = require("./config/mongoDb");
const authRoutes = require("./router/authRouter");
const adminRoutes = require("./router/adminRouter");
const usersRouter = require("./router/usersRouter");
// const giftRouter = require("./router/giftsRouter");
// const messagesRouter = require("./router/messagesRouter");
const roomsRouter = require("./router/roomsRouter");

const app = express();
connectMongose();

const PORT = process.env.PORT || 5001;

/* ===================== MIDDLEWARE ===================== */

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(bodyParser.json());
app.use(express.json());

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
// app.use("/api/gifts", giftRouter);
app.use("/api/users", usersRouter);
// app.use("/api/messages", messagesRouter);
app.use("/api/rooms", roomsRouter);

app.get("/", (req, res) => {
  res.send("API is running...");
});

/* ===================== SOCKET SETUP ===================== */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Socket events
require("./utils/socketEvents")(io);

/* ===================== START SERVER ===================== */

server.listen(PORT, () => {
  // ✅ FIX 2
  console.log(`Server is running on port ${PORT}`);
});
