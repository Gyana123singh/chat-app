const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const cloudinary = require("../config/cloudinary");

const uploadDir = path.resolve(process.cwd(), "uploads", "chat-gifts");
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const isSvga = file.originalname.toLowerCase().endsWith(".svga");
    const isSvg =
      file.originalname.toLowerCase().endsWith(".svg") ||
      file.mimetype === "image/svg+xml" ||
      file.mimetype === "image/svg";
    const originalExt = path.extname(file.originalname).toLowerCase();
    const cleanFileName = file.originalname
      .split(".")[0]
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const finalExt = isSvga ? ".svga" : isSvg ? ".svg" : originalExt || "";
    cb(null, `${Date.now()}-${cleanFileName}${finalExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const isSvga = file.originalname.toLowerCase().endsWith(".svga");
    const isSvg =
      file.originalname.toLowerCase().endsWith(".svg") ||
      file.mimetype === "image/svg+xml" ||
      file.mimetype === "image/svg";

    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "image/svg",
      "application/pdf",
      "video/mp4",
      "application/x-svga",
      "application/octet-stream",
    ];

    if (allowedMimeTypes.includes(file.mimetype) || isSvga || isSvg) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only JPG, PNG, GIF, WEBP, SVG, PDF, MP4, and SVGA files (up to 50MB) are allowed"
        ),
        false
      );
    }
  },
});

// Helper to handle Cloudinary upload with local disk fallback
const processCloudinaryOrLocal = async (req, file) => {
  if (!file) return;

  const isSvga = file.originalname.toLowerCase().endsWith(".svga");
  const isSvg =
    file.originalname.toLowerCase().endsWith(".svg") ||
    file.mimetype === "image/svg+xml" ||
    file.mimetype === "image/svg";
  const isMp4 =
    file.mimetype === "video/mp4" ||
    file.mimetype.startsWith("video/") ||
    file.originalname.toLowerCase().endsWith(".mp4");

  const diskPath = file.path; // Absolute disk path saved by multer
  const protocol = req.protocol || "http";
  const host = (req.get && req.get("host")) || "localhost:5005";
  const baseUrl = `${protocol}://${host}`;
  const localUrl = `${baseUrl}/uploads/chat-gifts/${file.filename}`;

  // If file > 10MB, use local disk fallback. Small files, SVGs, and SVGAs upload to Cloudinary.
  if (file.size > 10 * 1024 * 1024) {
    file.path = localUrl;
    console.log(`✅ [Local Upload] Saved file to local storage (${(file.size / 1024 / 1024).toFixed(2)} MB):`, localUrl);
    return;
  }

  // Try Cloudinary upload for standard small files (<= 10MB)
  try {
    let resourceType = "image";
    const uploadOptions = {
      folder: "chat-gifts",
    };

    const cleanFileName = file.originalname
      .split(".")[0]
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    if (isMp4) {
      resourceType = "video";
    } else if (isSvga) {
      resourceType = "raw";
      uploadOptions.public_id = `${Date.now()}-${cleanFileName}.svga`;
    } else if (isSvg) {
      resourceType = "image"; // Cloudinary natively supports SVG as an image format
      uploadOptions.public_id = `${Date.now()}-${cleanFileName}.svg`;
    }

    uploadOptions.resource_type = resourceType;

    const uploadResult = await cloudinary.uploader.upload(diskPath, uploadOptions);

    if (uploadResult && uploadResult.secure_url) {
      file.path = uploadResult.secure_url;
      console.log("☁️ [Cloudinary Upload] Success:", uploadResult.secure_url);
      // Remove temporary local file if Cloudinary succeeded
      fs.remove(diskPath).catch(() => { });
    } else {
      file.path = localUrl;
    }
  } catch (err) {
    console.warn("⚠️ [Cloudinary Upload Failed, using Local Fallback]:", err.message);
    file.path = localUrl;
  }
};

// Middleware wrapper generator
const wrapMiddleware = (multerFn) => (req, res, next) => {
  multerFn(req, res, async (err) => {
    if (err) return next(err);

    try {
      if (req.file) {
        await processCloudinaryOrLocal(req, req.file);
      }
      if (req.files) {
        if (Array.isArray(req.files)) {
          for (const file of req.files) {
            await processCloudinaryOrLocal(req, file);
          }
        } else {
          for (const key of Object.keys(req.files)) {
            for (const file of req.files[key]) {
              await processCloudinaryOrLocal(req, file);
            }
          }
        }
      }
      next();
    } catch (processErr) {
      next(processErr);
    }
  });
};

module.exports = {
  single: (fieldName) => wrapMiddleware(upload.single(fieldName)),
  array: (fieldName, maxCount) => wrapMiddleware(upload.array(fieldName, maxCount)),
  fields: (fields) => wrapMiddleware(upload.fields(fields)),
  any: () => wrapMiddleware(upload.any()),
  none: () => wrapMiddleware(upload.none()),
};