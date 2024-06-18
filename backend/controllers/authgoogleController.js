const passport = require("passport");
const GoogleUser = require("../models/usergoogleModel");

// Controller function to initiate Google OAuth authentication
exports.googleAuth = passport.authenticate("google", {
});

// Callback function for Google OAuth authentication
exports.googleAuthCallback = (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) {
      console.error('Error during authentication:', err);
      return next(err);
    }
    if (!user) {
      // Handle authentication failure
      console.log('Authentication failed');
       return res.redirect("http://localhost:3000/connect?error=Login failed");
      // return res.send("Login failed.");
    }
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('Error during login:', loginErr);
        return next(loginErr); // Pass the error to Express error handler
      }
      // Handle authentication success
      return res.redirect('http://localhost:3000/connect');
      // res.send("Google OAuth authentication successful!");
    });
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
      const user = await GoogleUser.findById(req.user._id);
      
      if (!user || !user.accessToken) {
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