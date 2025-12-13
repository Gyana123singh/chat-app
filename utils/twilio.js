const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendSms(to, body) {
  return client.messages.create({
    from: process.env.TWILIO_NUMBER,
    to,
    body,
  });
}

module.exports = { sendSms };
