const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let resourceType = "image";

    // 🔥 Force video for mp4
    if (file.mimetype === "video/mp4") {
      resourceType = "video";
    }

    // 🔥 Force raw for pdf
    if (file.mimetype === "application/pdf") {
      resourceType = "raw";
    }

    return {
      folder: "chat-gifts",
      resource_type: resourceType, // ❌ no more auto
      public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
    };
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/gif",
      "application/pdf",
      "video/mp4",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only JPG, PNG, GIF, PDF, and MP4 files are allowed"
        ),
        false
      );
    }
  },
});

module.exports = upload;