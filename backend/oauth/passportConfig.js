require('dotenv').config();

const passport = require("passport");
const axios = require("axios");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
const GoogleUser = require("../models/usergoogleModel");

// Initialize Passport.js
passport.initialize();

// Configure Passport.js with Google OAuth 2.0 Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: [
        "https://www.googleapis.com/auth/youtube",
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/youtube.upload",
      ],
      skipUserProfile: true,
      accessType: 'offline'
    },
    async (accessToken, refreshToken, _profile, done) => {
      try {

        // Make a request to the YouTube API to get the user's profile information
        const response = await axios.get(
          "https://www.googleapis.com/youtube/v3/channels",
          {
            params: {
              part: "snippet,contentDetails,statistics",
              mine: "true",
            },
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const youtubeProfile = response.data.items[0];
        const googleId = youtubeProfile.id;

        // Save user to the database or update existing user
        let user = await GoogleUser.findOne({ googleId });
        if (!user) {
          user = new GoogleUser({
            googleId,
            accessToken,
            refreshToken,
          });
        } else {
          // Update user's access token and refresh token
          user.accessToken = accessToken;
          user.refreshToken = refreshToken;
        }
        await user.save();
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

// Configure JWT Strategy
passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_GOOGLE_SECRET,
    },
    async (jwtPayload, done) => {
      try {
        const user = await GoogleUser.findById(jwtPayload.id);
        if (user) {
          return done(null, user);
        }
        return done(null, false);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

// Implement Passport.js Serialization and Deserialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const user = await GoogleUser.findById(id);
    if (!user) {
      // If user is not found, pass null as the user
      return done(null, null);
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
