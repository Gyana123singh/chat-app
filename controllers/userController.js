// controllers/userController.js
const User = require("../models/users");
const cloudinary = require("../config/cloudinary");

exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      "username phone country countryCode role lastSeen profile stats isVerified"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        username: user.username,
        avatar: user.profile.avatar,
        bio: user.profile.bio,
        language: user.profile.language,
        theme: user.profile.theme,

        country: user.country,
        countryCode: user.countryCode,
        phone: user.phone,

        coins: user.stats.coins,
        followers: user.stats.followers,
        following: user.stats.following,
        giftsReceived: user.stats.giftsReceived,
        totalHostingMinutes: user.stats.totalHostingMinutes,

        role: user.role,
        isVerified: user.isVerified,
        lastSeen: user.lastSeen,
      },
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const {
      username,
      phone,
      country,
      countryCode,
      avatar, // base64 image (only if user uploads)
      bio,
      language,
      theme,
      interests,
    } = req.body;

    const updateData = {};

    /* =========================
       TOP-LEVEL FIELDS
    ========================= */
    if (username) updateData.username = username;
    if (phone) updateData.phone = phone;
    if (country) updateData.country = country;
    if (countryCode) updateData.countryCode = countryCode;

    /* =========================
       AVATAR (CUSTOM IMAGE)
    ========================= */
    if (avatar) {
      const uploadResult = await cloudinary.uploader.upload(avatar, {
        folder: "users/avatar",
        transformation: [{ width: 300, height: 300, crop: "fill" }],
      });

      updateData["profile.avatar"] = uploadResult.secure_url;
      updateData["profile.avatarSource"] = "custom"; // 🔥 important
    }

    /* =========================
       PROFILE FIELDS
    ========================= */
    if (bio !== undefined) updateData["profile.bio"] = bio;
    if (language) updateData["profile.language"] = language;
    if (theme) updateData["profile.theme"] = theme;
    if (interests) updateData["profile.interests"] = interests;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("username phone country countryCode profile");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select(
        "username profile.avatar country role stats.followers stats.following stats.coins lastSeen"
      )
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};
exports.followUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (userId === id) {
      return res.status(400).json({
        success: false,
        message: "Cannot follow yourself",
      });
    }

    const user = await User.findById(userId);
    const targetUser = await User.findById(id);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isFollowing = user.following.includes(id);

    if (isFollowing) {
      user.following = user.following.filter((f) => f.toString() !== id);
      targetUser.followers = targetUser.followers.filter(
        (f) => f.toString() !== userId
      );
      user.stats.following -= 1;
      targetUser.stats.followers -= 1;
    } else {
      user.following.push(id);
      targetUser.followers.push(userId);
      user.stats.following += 1;
      targetUser.stats.followers += 1;
    }

    await user.save();
    await targetUser.save();

    res.status(200).json({
      success: true,
      message: isFollowing ? "Unfollowed" : "Followed",
      isFollowing: !isFollowing,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Follow operation failed",
      error: error.message,
    });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Query must be at least 2 characters",
      });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
    })
      .select("username profile.avatar stats")
      .limit(20);

    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Search failed",
      error: error.message,
    });
  }
};

exports.getFollowers = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate(
      "followers",
      "username profile.avatar stats"
    );

    res.status(200).json({
      success: true,
      followers: user.followers,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch followers",
      error: error.message,
    });
  }
};

exports.getFollowing = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate(
      "following",
      "username profile.avatar stats"
    );

    res.status(200).json({
      success: true,
      following: user.following,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch following",
      error: error.message,
    });
  }
};

exports.getAccountSecurity = async (req, res) => {
  const user = await User.findById(req.userId).select("-password");

  res.json({
    securityStatus: "Safe",
    lastLogin: user.lastLogin,
    accountInfo: {
      diiId: user.diiId,
      phone: user.phone,
      email: user.email ? "Linked" : "Not Linked",
    },
    security: {
      biometric: user.biometricEnabled,
      protection: user.accountProtection,
    },
    thirdParty: user.thirdParty,
  });
};

// * CHANGE PASSWORD

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.userId);

  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Old password incorrect" });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  res.json({ message: "Password changed successfully" });
};

/**
 * TOGGLE BIOMETRIC LOGIN
 */
exports.toggleBiometric = async (req, res) => {
  const user = await User.findById(req.userId);
  user.biometricEnabled = !user.biometricEnabled;
  await user.save();

  res.json({
    message: "Biometric setting updated",
    enabled: user.biometricEnabled,
  });
};

/**
 * LINK / UNLINK THIRD PARTY
 */
exports.updateThirdParty = async (req, res) => {
  const { provider, status } = req.body; // google / facebook

  const user = await User.findById(req.userId);
  user.thirdParty[provider] = status;
  await user.save();

  res.json({ message: `${provider} updated` });
};
