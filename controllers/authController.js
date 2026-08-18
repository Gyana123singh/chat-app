const { signToken } = require("../utils/jwtAuth");
const User = require("../models/users");
const bcrypt = require("bcryptjs");
const generateDisplayId = require("../utils/generateDisplayId");
const admin = require("../config/firebaseAdmin");

// for google OAuth login
exports.googleAuthSuccess = async (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.CLIENT_URL}/Login?error=google`);
  }

  const token = signToken(req.user);

  // ✅ Redirect to Vercel frontend
  res.redirect(`myapp://auth/google/success?token=${token}`);
};

// Helper to verify Google Token (supports both Google Console OAuth Client ID & Firebase Auth)
function verifyGoogleTokenHttp(idToken) {
  return new Promise((resolve) => {
    const https = require("https");
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const payload = JSON.parse(data);
            if (payload && payload.email) {
              resolve({
                uid: payload.sub,
                email: payload.email,
                name: payload.name || payload.email.split("@")[0],
                picture: payload.picture || "",
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

async function verifyGoogleTokenPayload(idToken) {
  // 1️⃣ Try Google Console OAuth Token Validation (https://oauth2.googleapis.com/tokeninfo)
  try {
    const googleUserData = await verifyGoogleTokenHttp(idToken);
    if (googleUserData && googleUserData.email) {
      return googleUserData;
    }
  } catch (err) {
    console.log("Google TokenInfo check failed, trying Firebase Admin...", err.message);
  }

  // 2️⃣ Fallback to Firebase Admin Verification
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return {
      uid: decoded.uid || decoded.sub,
      email: decoded.email,
      name: decoded.name || (decoded.email ? decoded.email.split("@")[0] : ""),
      picture: decoded.picture || "",
    };
  } catch (err) {
    console.error("Firebase Admin verification failed:", err.message);
    throw err;
  }
}

// for Native Google / Firebase Login (Directly from APK / Mobile App using ID Token)
exports.googleFirebaseLogin = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: "ID token is required" });
    }

    const decoded = await verifyGoogleTokenPayload(idToken);
    const email = decoded.email;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email not found in Google token" });
    }

    let user = await User.findOne({ oauthProviderId: decoded.uid });
    if (!user) {
      user = await User.findOne({ email });
      if (user) {
        user.oauthProvider = "google";
        user.oauthProviderId = decoded.uid;
      } else {
        const displayId = await generateDisplayId();
        user = await User.create({
          username: decoded.name || email.split("@")[0],
          email,
          displayId,
          oauthProvider: "google",
          oauthProviderId: decoded.uid,
          isVerified: true,
          profile: {
            avatar: decoded.picture || "",
          },
        });
      }
    }

    if (!user.displayId) {
      user.displayId = await generateDisplayId();
    }
    await user.save();

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: "Google login successful",
      token,
      userId: user._id,
      user: {
        _id: user._id,
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayId: user.displayId,
        avatar: user.profile?.avatar || "",
      },
    });
  } catch (error) {
    console.error("FIREBASE GOOGLE LOGIN ERROR:", error);
    return res.status(401).json({ success: false, message: "Invalid or expired Google token" });
  }
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

    const adminEmail = (process.env.ADMIN_EMAIL || "gyan123priya@gmail.com").trim().toLowerCase();
    const isSuperAdmin = email && email.trim().toLowerCase() === adminEmail;
    const userRole = isSuperAdmin ? "superadmin" : "user";

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: userRole,
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

    const adminEmail = (process.env.ADMIN_EMAIL || "gyan123priya@gmail.com").trim().toLowerCase();
    if (user.email && user.email.trim().toLowerCase() === adminEmail && user.role !== "superadmin") {
      user.role = "superadmin";
      await user.save();
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
