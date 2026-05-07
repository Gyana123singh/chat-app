const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");

module.exports = () => {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const { roomId } = req.params;

        const dir = path.resolve(
          process.cwd(),
          "uploads",
          "videos",
          roomId
        );

        await fs.ensureDir(dir);

        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },

    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  return multer({
    storage,

    fileFilter: (req, file, cb) => {
      const allowed = [
        ".mp4",
        ".mov",
        ".mkv",
        ".webm",
      ];

      const ext = path
        .extname(file.originalname)
        .toLowerCase();

      if (!allowed.includes(ext)) {
        return cb(
          new Error(
            "Only MP4 / MOV / MKV / WEBM allowed"
          )
        );
      }

      cb(null, true);
    },

    limits: {
      fileSize: 500 * 1024 * 1024,
    },
  });
};