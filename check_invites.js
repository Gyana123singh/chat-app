const mongoose = require("mongoose");
const MONGO_URL = "mongodb+srv://gyan123priya_db_user:AbBHFubnmCTXzpgx@cluster0.qiu7h2r.mongodb.net/?appName=Cluster0";

const RoomInvite = require("./models/roomInvite");

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log("✅ Connected to DB.");

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  const invites = await RoomInvite.find({
    createdAt: { $gte: fifteenMinutesAgo }
  });

  console.log(`Found ${invites.length} invites in the last 15 minutes:`);
  invites.forEach(inv => {
    console.log({
      id: inv._id,
      roomId: inv.roomId,
      roomTitle: inv.roomTitle,
      invitedBy: inv.invitedBy,
      invitedUsers: inv.invitedUsers,
      createdAt: inv.createdAt
    });
  });

  await mongoose.disconnect();
}

run().catch(console.error);
