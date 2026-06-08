const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");
const bcrypt = require("bcryptjs");
const generateDisplayId = require("../utils/generateDisplayId");

// for google OAuth login
exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = signToken(req.user);

  // ✅ Redirect to Vercel frontend
  res.redirect(`myapp://auth/google/success?token=${token}`);
};

// Register user with email and password
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Username, email and password are required",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const displayId = await generateDisplayId();

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: "user",
      displayId,
    });

    const token = signToken(user);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayId: user.displayId,
      },
    });
  } catch (error) {
    console.error("USER REGISTER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
};

// Login user with email and password
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      userId: user._id,
      user: {
        _id: user._id,
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayId: user.displayId,
      },
    });
  } catch (error) {
    console.error("USER LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

// for phone OTP login
