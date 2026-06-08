const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const { getDashboardStats } = require("./controllers/adminContrroler");

mongoose.connect(process.env.MONGO_URL, { family: 4 })
  .then(async () => {
    console.log("Connected to MongoDB");
    // Simulate req and res
    const req = {};
    const res = {
      status: (code) => {
        console.log("Status Code:", code);
        return res;
      },
      json: (data) => {
        console.log("Response JSON:", JSON.stringify(data, null, 2));
      }
    };
    await getDashboardStats(req, res);
    mongoose.connection.close();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
