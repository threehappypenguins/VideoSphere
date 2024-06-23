const express = require("express");
const router = express.Router();
const authgoogleController = require("../controllers/authgoogleController");
const { protect } = require("../controllers/authController");

// Route for initiating Google OAuth authentication
router.get("/", protect, authgoogleController.googleAuth);

// Route for handling the OAuth callback
router.get("/callback", protect, authgoogleController.googleAuthCallback);

// Route for user logout
router.get("/logout", protect, authgoogleController.logout);

// Route for checking connection status
router.get("/status", protect, authgoogleController.status);

// Route for refreshing the token
//router.post("/refresh", authgoogleController.refreshToken);

module.exports = router;
