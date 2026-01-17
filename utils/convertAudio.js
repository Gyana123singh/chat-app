const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

function convertToMp3(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(path.extname(inputPath), ".mp3");

    ffmpeg(inputPath)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .format("mp3")
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .save(outputPath);
  });
}

module.exports = convertToMp3;
