const admin = require("firebase-admin");

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      ),
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(require("../firebase-admin.json")),
    });
  }
}

console.log("🔥 Firebase Admin Initialized");

module.exports = admin;
