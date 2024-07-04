const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const usergoogleSchema = new Schema({
  googleId: String,
  accessToken: String,
  refreshToken: String,
  userId: { type: String, ref: 'User' },
});

module.exports = mongoose.model("GoogleUser", usergoogleSchema);
