const passport = require("passport");
const jwt = require("jsonwebtoken");
const GoogleUser = require("../models/usergoogleModel");
const User = require("../models/userModel");
//const { protect } = require("../controllers/authController");

// Controller function to initiate Google OAuth authentication
exports.googleAuth = passport.authorize("google", {});

// Callback function for Google OAuth authentication
exports.googleAuthCallback = (req, res, next) => {
    passport.authorize("google", async (err, googleUser, info) => {
      if (err) {
        console.error("Error during authorization:", err);
        return next(err);
      }
      if (!googleUser) {
        return res.redirect("http://localhost:3000/connect?error=Login failed");
      }

      try {
        const loggedInUserId = req.session.passport.user;

        // Associate the YouTube account with the logged-in user
        const user = await User.findById(loggedInUserId);
        if (!user) {
          console.error("User not found in database");
          return res.redirect("http://localhost:3000/connect?error=User not found");
        }

        user.googleUserId = googleUser._id;
        await user.save();

        req.login(googleUser, async (loginErr) => {
          if (loginErr) {
            console.error("Error during login:", loginErr);
            return next(loginErr);
          }

        // Generate JWT
        const accessToken = jwt.sign({ id: googleUser._id }, process.env.JWT_GOOGLE_SECRET, {
          expiresIn: "1h",
        });
        const refreshToken = jwt.sign(
          { id: googleUser._id },
          process.env.JWT_GOOGLE_REFRESH_SECRET,
          { expiresIn: "30d" }
        );

        // Store refresh token in the database
        googleUser.refreshToken = refreshToken;
        await googleUser.save();

        // Redirect with tokens as query parameters
        res.redirect(
          `http://localhost:3000/connect?accessToken=${accessToken}&refreshToken=${refreshToken}`
        );
      });
    } catch (error) {
      console.error("Error associating Google account with user:", error);
      return res.redirect("http://localhost:3000/connect?error=Server error");
    }
    })(req, res, next);
  };

// Controller function for user logout
exports.logout = (req, res) => {
  req.logout(() => {
    //    res.redirect("/"); // Redirect to the home page after logout
    res.send("Logout successful!");
  });
};

// Controller for checking connection status
exports.status = async (req, res) => {
    try {
      if (req.isAuthenticated()) {
        // Use the GoogleUser model to find the user by _id
        const googleUser = await GoogleUser.findById(req.user._id);

        if (!googleUser || !googleUser.accessToken) {
          return res.json({ connected: false });
        }
        res.json({ connected: true });
      } else {
        res.json({ connected: false });
      }
    } catch (err) {
      console.error("Error checking status:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };

// Controller for retrieving tokens
exports.tokens = async (req, res) => {
  try {
    const googleUser = await GoogleUser.findById(req.user.id);
    if (!googleUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      accessToken: googleUser.accessToken,
      refreshToken: googleUser.refreshToken
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
}
