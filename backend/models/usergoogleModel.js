const mongoose = require("mongoose");
const usergoogleSchema = new mongoose.Schema({
  googleId: String,
  accessToken: String,
  refreshToken: String,
});

module.exports = mongoose.model("GoogleUser", usergoogleSchema);
