// controllers/userController.js
const User = require("../models/Users");

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("followers", "username profile.avatar")
      .populate("following", "username profile.avatar");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { bio, avatar, language, theme, interests } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        profile: {
          bio: bio || "",
          avatar: avatar || "",
          language: language || "English",
          theme: theme || "dark",
          interests: interests || [],
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: user.toJSON(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message,
    });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("followers", "username profile.avatar")
      .populate("following", "username profile.avatar");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user",
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
