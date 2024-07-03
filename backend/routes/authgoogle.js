const express = require("express");
const router = express.Router();
const authgoogleController = require("../controllers/authgoogleController");
//const { protect } = require("../controllers/authController");

// Route for initiating Google OAuth authentication
router.get("/", authgoogleController.googleAuth);

// Route for handling the OAuth callback
router.get("/callback", authgoogleController.googleAuthCallback);

// Route for user logout
router.get("/logout", authgoogleController.logout);

// Route for checking connection status
router.get("/status", authgoogleController.status);

// Route for retrieving tokens
router.get("/tokens", authgoogleController.tokens);

// Route for refreshing the token
//router.post("/refresh", authgoogleController.refreshToken);

module.exports = router;
