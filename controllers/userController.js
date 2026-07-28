const User = require("../models/users");
const cloudinary = require("../config/cloudinary");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const PrivateMessage = require("../models/privateMessage");
const StoreGiftTransaction = require("../models/storeGiftTransaction");

async function resolveRingPartner(user) {
  if (!user || !user.profile || !user.profile.ring) {
    return null;
  }

  let ringPartner = user.profile.ringPartner
    ? (user.profile.ringPartner.toObject ? user.profile.ringPartner.toObject() : { ...user.profile.ringPartner })
    : null;

  // 1. If userId is stored in ringPartner, fetch fresh username & avatar
  if (ringPartner && ringPartner.userId) {
    try {
      const partner = await User.findById(ringPartner.userId)
        .select("username profile.avatar avatar")
        .lean();
      if (partner) {
        ringPartner = {
          userId: partner._id,
          username: partner.username,
          avatar: partner.profile?.avatar || partner.avatar || ringPartner.avatar || null,
        };
        return ringPartner;
      }
    } catch (err) {
      console.error("Error resolving ringPartner by userId:", err);
    }
  }

  // 2. Find partner from accepted PrivateMessage
  try {
    const ringMsg = await PrivateMessage.findOne({
      $or: [{ sender: user._id }, { recipient: user._id }],
      text: { $regex: /\[RING_GIFT:/i }
    }).sort({ updatedAt: -1 }).lean();

    if (ringMsg) {
      const partnerId = ringMsg.sender.toString() === user._id.toString()
        ? ringMsg.recipient
        : ringMsg.sender;

      const partner = await User.findById(partnerId)
        .select("username profile.avatar avatar")
        .lean();

      if (partner) {
        ringPartner = {
          userId: partner._id,
          username: partner.username,
          avatar: partner.profile?.avatar || partner.avatar || null,
        };

        // Persist to user's profile in DB
        User.findByIdAndUpdate(user._id, {
          $set: { "profile.ringPartner": ringPartner }
        }).catch(e => console.error("Error saving ringPartner back to user:", e));

        return ringPartner;
      }
    }
  } catch (err) {
    console.error("Error resolving ringPartner from PrivateMessage:", err);
  }

  // 3. Find partner by searching another user who has the EXACT same ring equipped!
  try {
    const partner = await User.findOne({
      _id: { $ne: user._id },
      "profile.ring": user.profile.ring
    }).select("username profile.avatar avatar").lean();

    if (partner) {
      ringPartner = {
        userId: partner._id,
        username: partner.username,
        avatar: partner.profile?.avatar || partner.avatar || null,
      };

      User.findByIdAndUpdate(user._id, {
        $set: { "profile.ringPartner": ringPartner }
      }).catch(e => console.error("Error saving ringPartner from ring match:", e));

      return ringPartner;
    }
  } catch (err) {
    console.error("Error resolving ringPartner from ring match:", err);
  }

  // 4. Find partner from StoreGiftTransaction
  try {
    const tx = await StoreGiftTransaction.findOne({
      $or: [{ senderId: user._id }, { receiverIds: user._id }]
    }).sort({ createdAt: -1 }).lean();

    if (tx) {
      const partnerId = tx.senderId.toString() === user._id.toString()
        ? (tx.receiverIds && tx.receiverIds[0])
        : tx.senderId;

      if (partnerId && partnerId.toString() !== user._id.toString()) {
        const partner = await User.findById(partnerId)
          .select("username profile.avatar avatar")
          .lean();

        if (partner) {
          ringPartner = {
            userId: partner._id,
            username: partner.username,
            avatar: partner.profile?.avatar || partner.avatar || null,
          };

          User.findByIdAndUpdate(user._id, {
            $set: { "profile.ringPartner": ringPartner }
          }).catch(e => console.error("Error saving ringPartner from tx:", e));

          return ringPartner;
        }
      }
    }
  } catch (err) {
    console.error("Error resolving ringPartner from StoreGiftTransaction:", err);
  }

  return ringPartner;
}

// ================= GET PROFILE =================
exports.getUserById = async (req, res) => {
  try {
    let userId = req.user.id;
    console.log(`🔍 [getUserById] req.user.id: "${req.user.id}", req.query.userId: "${req.query.userId}"`);
    if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
      userId = req.query.userId;
      console.log(`🔍 [getUserById] Using query userId: "${userId}"`);
    } else {
      console.log(`🔍 [getUserById] Using req.user.id fallback: "${userId}"`);
    }

    const user = await User.findById(userId).select(
      "username phone country countryCode role lastSeen profile stats coins isVerified displayId gender birthday birthDate birthdate dob age"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ringPartner = await resolveRingPartner(user);

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        displayId: user.displayId, // ✅ FIX
        username: user.username,
        avatar: user.profile?.avatar,
        bio: user.profile?.bio,
        theme: user.profile?.theme,
        themeUrl: user.profile?.themeUrl,
        ring: user.profile?.ring,
        ringPartner,
        frame: user.profile?.frame,
        bubble: user.profile?.bubble,
        entranceEffect: user.profile?.entranceEffect,
        profile: user.profile,

        country: user.country,
        countryCode: user.countryCode,
        phone: user.phone,
        gender: user.gender || "Other",
        birthday: user.birthday || null,
        birthDate: user.birthDate || user.birthday || null,
        birthdate: user.birthdate || user.birthday || null,
        dob: user.dob || user.birthday || null,
        age: user.age || 18,

        coins: Math.max(user.coins || 0, user.stats?.coins || 0),
        followers: user.stats?.followers,
        following: user.stats?.following,
        giftsReceived: user.stats?.giftsReceived,
        totalHostingMinutes: user.stats?.totalHostingMinutes,

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

exports.getProfileDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing user ID",
      });
    }

    const user = await User.findById(userId).select(
      "username phone country countryCode role lastSeen profile stats coins isVerified displayId gender birthday birthDate birthdate dob age"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const ringPartner = await resolveRingPartner(user);

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        displayId: user.displayId,
        username: user.username,
        avatar: user.profile?.avatar,
        bio: user.profile?.bio,
        theme: user.profile?.theme,
        themeUrl: user.profile?.themeUrl,
        ring: user.profile?.ring,
        ringPartner,
        frame: user.profile?.frame,
        bubble: user.profile?.bubble,
        entranceEffect: user.profile?.entranceEffect,
        profile: user.profile,

        country: user.country,
        countryCode: user.countryCode,
        phone: user.phone,
        gender: user.gender || "Other",
        birthday: user.birthday || null,
        birthDate: user.birthDate || user.birthday || null,
        birthdate: user.birthdate || user.birthday || null,
        dob: user.dob || user.birthday || null,
        age: user.age || 18,

        coins: Math.max(user.coins || 0, user.stats?.coins || 0),
        followers: user.stats?.followers,
        following: user.stats?.following,
        giftsReceived: user.stats?.giftsReceived,
        totalHostingMinutes: user.stats?.totalHostingMinutes,

        role: user.role,
        isVerified: user.isVerified,
        lastSeen: user.lastSeen,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ================= UPDATE PROFILE =================
exports.updateProfile = async (req, res) => {
  try {
    // ✅ Auth check
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const userId = req.user.id;
    console.log("📦 BODY:", req.body);

    // Support both root-level and nested req.body.profile structures
    const profileData = req.body.profile || {};

    const {
      username,
      country,
      countryCode,
      avatar,
      theme,
      gender,
      birthday,
      birthDate,
      birthdate,
      dob,
    } = req.body;

    const finalUsername = username || profileData.username;
    const finalCountry = country || profileData.country;
    const finalCountryCode = countryCode || profileData.countryCode;
    const finalTheme = theme || profileData.theme;
    const finalGender = gender || profileData.gender;
    const finalAvatar = avatar || profileData.avatar;
    const inputBirthday = birthday || birthDate || birthdate || dob || 
                          profileData.birthday || profileData.birthDate || profileData.birthdate || profileData.dob;

    const updateData = {};

    // ✅ ENUM VALIDATION
    const validCountries = ["IN", "PK", "BD"];
    const validCodes = ["+91", "+92", "+880"];

    // ✅ BASIC FIELDS
    if (finalUsername) updateData.username = finalUsername;

    if (finalCountry) {
      if (!validCountries.includes(finalCountry)) {
        return res.status(400).json({
          success: false,
          message: "Invalid country",
        });
      }
      updateData.country = finalCountry;
    }

    if (finalCountryCode) {
      if (!validCodes.includes(finalCountryCode)) {
        return res.status(400).json({
          success: false,
          message: "Invalid country code",
        });
      }
      updateData.countryCode = finalCountryCode;
    }

    // ✅ Ensure profile exists
    await User.updateOne(
      { _id: userId, profile: { $exists: false } },
      { $set: { profile: {} } },
    );

    // ✅ PROFILE FIELDS
    if (finalTheme) updateData["profile.theme"] = finalTheme;

    // ✅ gender (normalized to "Male", "Female", "Other")
    if (finalGender) {
      const normalizedGender = finalGender.charAt(0).toUpperCase() + finalGender.slice(1).toLowerCase();
      const validGenders = ["Male", "Female", "Other"];
      if (validGenders.includes(normalizedGender)) {
        updateData.gender = normalizedGender;
      } else {
        updateData.gender = "Other";
      }
    }

    // ✅ birthday & age calculation with robust parsing to prevent CastError/NaN
    if (inputBirthday) {
      try {
        let birthDateObj = new Date(inputBirthday);

        // Handle common formats like DD/MM/YYYY or DD-MM-YYYY if standard parsing fails
        if (isNaN(birthDateObj.getTime()) && typeof inputBirthday === "string") {
          const parts = inputBirthday.trim().split(/[-/]/);
          if (parts.length === 3) {
            if (parts[2].length === 4) { // DD/MM/YYYY
              const day = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              const year = parseInt(parts[2], 10);
              birthDateObj = new Date(year, month, day);
            } else if (parts[0].length === 4) { // YYYY/MM/DD
              const year = parseInt(parts[0], 10);
              const month = parseInt(parts[1], 10) - 1;
              const day = parseInt(parts[2], 10);
              birthDateObj = new Date(year, month, day);
            }
          }
        }

        if (!isNaN(birthDateObj.getTime())) {
          const formattedDate = birthDateObj.toISOString().split("T")[0];
          updateData.birthday = formattedDate;
          updateData.birthDate = formattedDate;
          updateData.birthdate = formattedDate;
          updateData.dob = formattedDate;

          const today = new Date();
          let calculatedAge = today.getFullYear() - birthDateObj.getFullYear();
          const m = today.getMonth() - birthDateObj.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birthDateObj.getDate())) {
            calculatedAge--;
          }
          // Only update age if it is a valid positive number
          if (!isNaN(calculatedAge) && calculatedAge >= 0) {
            updateData.age = calculatedAge;
          }
        } else {
          // If the date is completely invalid, store the raw input string for these fields
          // but DO NOT set updateData.age to NaN (so it doesn't cause CastError in MongoDB)
          console.warn("⚠️ Invalid birthday string format received, saving as raw string:", inputBirthday);
          updateData.birthday = inputBirthday;
          updateData.birthDate = inputBirthday;
          updateData.birthdate = inputBirthday;
          updateData.dob = inputBirthday;
        }
      } catch (e) {
        console.error("Age calculation error:", e);
      }
    }

    // ✅ Avatar upload (safe)
    if (finalAvatar) {
      if (finalAvatar.startsWith("data:image")) {
        try {
          const uploadResult = await cloudinary.uploader.upload(finalAvatar, {
            folder: "users/avatar",
            transformation: [{ width: 300, height: 300, crop: "fill" }],
          });

          updateData["profile.avatar"] = uploadResult.secure_url;
          updateData["profile.avatarSource"] = "custom";
        } catch (err) {
          console.error("❌ Cloudinary Error:", err);
          return res.status(500).json({
            success: false,
            message: "Image upload failed",
          });
        }
      } else if (finalAvatar.startsWith("http")) {
        updateData["profile.avatar"] = finalAvatar;
      }
    }

    // ✅ Nothing to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid data provided",
      });
    }

    console.log("✅ updateData going to DB:", JSON.stringify(updateData, null, 2));

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true },
    );

    // Sync room creatorAvatar if user updated their profile avatar
    if (updateData["profile.avatar"]) {
      try {
        const Room = require("../models/room");
        await Room.updateMany(
          { host: userId, status: "active" },
          { $set: { creatorAvatar: updateData["profile.avatar"] } }
        );
        console.log(`✅ Synchronized room creatorAvatar for user ${userId} to ${updateData["profile.avatar"]}`);
      } catch (err) {
        console.error("❌ Failed to synchronize room creatorAvatar:", err);
      }
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("🔥 FULL ERROR:", error.stack);

    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select(
        "username profile.avatar country role stats.followers stats.following stats.coins lastSeen",
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

    // ✅ safety checks
    if (!user || !targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isFollowing = user.following.includes(id);

    if (isFollowing) {
      user.following = user.following.filter((f) => f.toString() !== id);
      targetUser.followers = targetUser.followers.filter(
        (f) => f.toString() !== userId,
      );

      // ✅ prevent negative values
      user.stats.following = Math.max(0, user.stats.following - 1);
      targetUser.stats.followers = Math.max(0, targetUser.stats.followers - 1);
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

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Query required",
      });
    }

    const trimmed = query.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    const searchQuery = {
      $or: [
        { username: { $regex: trimmed, $options: "i" } },
        { email: { $regex: trimmed, $options: "i" } },
        { displayId: trimmed },
        { displayId: { $regex: trimmed, $options: "i" } },
      ],
    };

    if (isNumeric) {
      searchQuery.$or.push({ displayId: Number(trimmed) });
    }

    if (mongoose.Types.ObjectId.isValid(trimmed)) {
      searchQuery.$or.push({ _id: new mongoose.Types.ObjectId(trimmed) });
    }

    const users = await User.find(searchQuery)
      .select("_id username email displayId profile.avatar role")
      .limit(20)
      .lean();

    res.status(200).json({
      success: true,
      data: users,
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
      "username profile.avatar stats",
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
      "username profile.avatar stats",
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
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      displayId: user.displayId || user.diiId || "",
      phone: user.phone || "",
      email: user.email || "",
      accountInfo: {
        dilId: user.displayId || user.diiId || "",
        phone: user.phone || "",
        email: user.email || "",
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// * CHANGE PASSWORD

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Old password incorrect",
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * TOGGLE BIOMETRIC LOGIN
 */
exports.toggleBiometric = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.biometricEnabled = !user.biometricEnabled;
    await user.save();

    res.json({
      message: "Biometric setting updated",
      enabled: user.biometricEnabled,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * LINK / UNLINK THIRD PARTY
 */
exports.updateThirdParty = async (req, res) => {
  try {
    const { provider, status } = req.body;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.thirdParty[provider] = status;
    await user.save();

    res.json({ message: `${provider} updated` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
