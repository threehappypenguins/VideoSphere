const express = require("express");
const router = express.Router();
const authgoogleController = require("../controllers/authgoogleController");

// Route for initiating Google OAuth authentication
router.get("/", authgoogleController.googleAuth);

// Route for handling the OAuth callback
router.get("/callback", authgoogleController.googleAuthCallback);

// Route for user logout
router.get("/logout", authgoogleController.logout);

module.exports = router;
