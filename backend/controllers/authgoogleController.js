const passport = require("passport");

// Controller function to initiate Google OAuth authentication
exports.googleAuth = passport.authenticate("google", {
});

// Callback function for Google OAuth authentication
exports.googleAuthCallback = (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      // Handle authentication failure
      //  return res.redirect("/login"); // Redirect to the login page or handle appropriately
      return res.send("Login failed.");
    }
    // Handle authentication success
    res.send("Google OAuth authentication successful!"); // Send a response indicating successful authentication
  })(req, res, next);
};

// Controller function for user logout
exports.logout = (req, res) => {
  req.logout(() => {
    //    res.redirect("/"); // Redirect to the home page after logout
    res.send("Logout successful!");
  });
};
