const mongoose = require("mongoose");
const MONGO_URL = "mongodb+srv://gyan123priya_db_user:AbBHFubnmCTXzpgx@cluster0.qiu7h2r.mongodb.net/?appName=Cluster0";

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log("✅ Connected.");

  const TempLog = mongoose.models.TempLog || mongoose.model("TempLog", new mongoose.Schema({ error: String, timestamp: Date }, { strict: false }));
  
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const logs = await TempLog.find({ timestamp: { $gte: tenMinutesAgo } }).sort({ timestamp: -1 });

  console.log(`Logs found: ${logs.length}`);
  logs.forEach(log => {
    console.log(`[${log.timestamp.toISOString()}] ${log.error}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
