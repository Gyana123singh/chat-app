// controllers/userController.js
const User = require("../models/users");

exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select(
      "name profileImage level age gender country sentGifts receivedGifts isSVIP"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        profileImage: user.profileImage,
        level: user.level,
        age: user.age,
        gender: user.gender,
        country: user.country,
        sent: user.sentGifts,
        received: user.receivedGifts,
        isSVIP: user.isSVIP,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const {
      name,
      birthday,
      gender,
      country,
      whatsapp,
      spaceBackgrounds,
      profileImage,
    } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        name,
        birthday,
        gender,
        country,
        whatsapp,
        spaceBackgrounds,
        profileImage,
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
exports.getProfile = async (req, res) => {
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
