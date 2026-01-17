const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");

module.exports = (roomIdGetter) => {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const roomId = roomIdGetter(req);
      const dir = path.resolve(process.cwd(), "uploads", roomId);
      await fs.ensureDir(dir);
      cb(null, dir);
    },

    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  return multer({
    storage,
    fileFilter: (req, file, cb) => {
      const allowed = [".mp3", ".m4a", ".aac", ".wav"];
      const ext = path.extname(file.originalname).toLowerCase();

      if (!allowed.includes(ext)) {
        return cb(
          new Error("Only MP3 / M4A / AAC / WAV audio allowed")
        );
      }

      cb(null, true);
    },
    limits: {
      fileSize: 100 * 1024 * 1024,
    },
  });
};
