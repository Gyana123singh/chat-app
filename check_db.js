const mongoose = require("mongoose");
const MONGO_URL = "mongodb+srv://gyan123priya_db_user:AbBHFubnmCTXzpgx@cluster0.qiu7h2r.mongodb.net/?appName=Cluster0";

const RoomInvite = require("./models/roomInvite");
const PrivateMessage = require("./models/privateMessage");

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log("✅ Connected to DB.");

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const invites = await RoomInvite.find({
    createdAt: { $gte: fiveMinutesAgo }
  });

  console.log(`\nInvites created in the last 5 minutes: ${invites.length}`);
  invites.forEach(i => {
    console.log({
      id: i._id,
      roomId: i.roomId,
      invitedBy: i.invitedBy,
      invitedUsers: i.invitedUsers,
      createdAt: i.createdAt
    });
  });

  const messages = await PrivateMessage.find({
    createdAt: { $gte: fiveMinutesAgo }
  });

  console.log(`\nPrivate messages created in the last 5 minutes: ${messages.length}`);
  messages.forEach(m => {
    console.log({
      id: m._id,
      conversationId: m.conversationId,
      sender: m.sender,
      recipient: m.recipient,
      text: m.text,
      createdAt: m.createdAt
    });
  });

  await mongoose.disconnect();
}

run().catch(console.error);
