require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const passport = require("./oauth/passportConfig");
const metadataRoutes = require("./routes/metadata");
const authgoogleRoutes = require("./routes/authgoogle");

// Express app
const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Use cookie-parser middleware
app.use(cookieParser());

// Middleware for handling metadata
app.use(express.json());

app.use((req, res, next) => {
  console.log(req.path, req.method);
  next();
});

// Middleware to initialize Passport and configure session
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    saveUninitialized: false,
    cookie: {
      sameSite: process.env.SESSION_SAMESITE || "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
  })
);

app.use(passport.session());

//  Routes
app.use("/api/metadata", metadataRoutes);
app.use("/auth/google", authgoogleRoutes);

// Connect to db
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    // Listen for requests
    app.listen(process.env.PORT, () => {
      console.log("Connected to the db & listening on port", process.env.PORT);
    });
  })
  .catch((error) => {
    console.log(error);
  });
