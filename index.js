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

app.get("/", (req, res) => {
  res.send("API is running...");
});

/* ===================== SOCKET SETUP ===================== */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

require("./middleware/soket.middleware")(io);
require("./utils/socketEvents")(io);

/* ===================== START SERVER ===================== */

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
