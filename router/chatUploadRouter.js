const express = require("express");
const upload = require("../middleware/multer.middleware");

const router = express.Router();

router.post("/image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded" });
  }

  // The Cloudinary storage middleware stores the secure URL in req.file.path
  const imageUrl = req.file.path;

  res.json({
    success: true,
    imageUrl,
  });
});

module.exports = router;
