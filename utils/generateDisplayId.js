const User = require("../models/users");

async function generateDisplayId() {
  let displayId;
  let exists = true;

  while (exists) {
    displayId = Math.floor(10000000 + Math.random() * 90000000);
    exists = await User.exists({ displayId });
  }

  return displayId;
}

module.exports = generateDisplayId;
