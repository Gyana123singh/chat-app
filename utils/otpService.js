const Otp = require("../models/otp");
const User = require("../models/Users");
const { generateToken } = require("../utils/jwt");
const twilio = require("twilio");
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);


const sendOtp = async (phone) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await Otp.findOneAndUpdate(
    { phone },
    { code, phone, expiresAt: new Date(Date.now() + 5 * 60000), attempts: 0 },
    { upsert: true }
  );

  await client.messages.create({
    body: `Your OTP code is ${code}`,
    from: TWILIO_NUMBER,
    to: phone,
  });
};
const verifyOtp = async (phone, code) => {
  const otp = await Otp.findOne({ phone });
  if (!otp) throw new Error("No OTP requested");
  if (otp.code !== code) throw new Error("Invalid OTP");

  let user = await User.findOne({ phone });
  if (!user) user = await User.create({ phone, name: phone });

  await Otp.deleteOne({ phone });

  return generateToken(user);
};

module.exports = { sendOtp, verifyOtp };
