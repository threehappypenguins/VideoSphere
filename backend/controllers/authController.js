require("dotenv").config();

const User = require("../models/userModel");
//const jwt = require("jsonwebtoken");

exports.signup = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = new User({ email, password });
    await user.save();
    res.status(201).json({ message: "User created" });
  } catch (err) {
    res.status(500).json({ message: "Error creating user", error: err });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Set session data
    req.session.authenticated = true;
    req.session.user = { id: user._id, email: user.email };

    // Optionally generate and send JWT token if needed
    // const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    // res.json({ token });

    res.status(200).json({ message: "Login successful" });

  } catch (err) {
    res.status(500).json({ message: "Error logging in", error: err });
  }
};

exports.logout = async (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Error logging out", error: err });
      }
      res.clearCookie("connect.sid");
      res.status(200).json({ message: "Logout successful" });
    });
  } catch (err) {
    res.status(500).json({ message: "Error logging out", error: err });
  }
};

// exports.protect = (req, res, next) => {
//   const token = req.headers.authorization?.split(" ")[1];
//   if (!token) {
//     return res.status(401).json({ message: "Not authenticated" });
//   }
//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     res.status(401).json({ message: "Invalid token" });
//   }
// };
