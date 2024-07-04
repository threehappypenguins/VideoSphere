require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const passport = require("./oauth/passportConfig");
const authRoutes = require("./routes/auth");
const authgoogleRoutes = require("./routes/authgoogle");
const metadataRoutes = require("./routes/metadata");

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

// Middleware for handling forms
app.use(express.urlencoded({ extended: true }));

// Middleware for handling metadata
app.use(express.json());

app.use((req, res, next) => {
  console.log(req.path, req.method);
  next();
});

// Session middleware for basic auth
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      autoRemove: 'native',
      ttl: 365 * 24 * 60 * 60 // 1 year in seconds
      //ttl: 60 // 1 minute
    }),
    saveUninitialized: false,
    cookie: {
      sameSite: process.env.SESSION_SAMESITE || "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year in milliseconds
      //maxAge: 60 * 1000 // 1 minute
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

//  Routes
app.use("/auth", authRoutes);
app.use("/auth/google", authgoogleRoutes);
app.use("/api/metadata", metadataRoutes);

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
