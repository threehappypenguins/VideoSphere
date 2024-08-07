require('dotenv').config();

const passport = require("passport");
const axios = require("axios");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
const GoogleUser = require("../models/usergoogleModel");
const User = require("../models/userModel");

// // Initialize Passport.js
// passport.initialize();

// Configure Passport.js with Google OAuth 2.0 Strategy
passport.use(
  "google",
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
      passReqToCallback: true,
      accessType: 'offline'
    },
    async (req, accessToken, refreshToken, _profile, done) => {
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

        if (!req.session || !req.session.user || !req.session.user.email) {
          return done(new Error("No authenticated user found in session"), null);
        }

        //const loggedInUserId = req.session.user.id;
        const loggedInUserEmail = req.session.user.email;

        // Save or update Google OAuth user in the database
        let googleUser = await GoogleUser.findOne({ googleId });
        if (!googleUser) {
          googleUser = new GoogleUser({
            googleId,
            accessToken,
            refreshToken,
            userId: loggedInUserEmail,
          });
        } else {
          // Update user's access token and refresh token
          googleUser.accessToken = accessToken;
          googleUser.refreshToken = refreshToken;
        }
        await googleUser.save();

        // // Associate the YouTube account with the logged-in basic auth user
        // if (req.account) {
        //   console.log("User authenticated, associating with Google account:", req.account);
        //   const dbUser = await User.findOne({ email: loggedInUserEmail });
        //   if (dbUser) {
        //     dbUser.userId = req.account._id;
        //     await dbUser.save();
        //   }
        // } else {
        //   console.log("No authenticated user found in req.account");
        // }

        done(null, googleUser);
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
        const googleUser = await GoogleUser.findById(jwtPayload.id);
        if (googleUser) {
          return done(null, googleUser);
        }
        return done(null, false);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

// Implement Passport.js Serialization and Deserialization for Google OAuth
passport.serializeUser((googleUser, done) => {
  done(null, googleUser.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const googleUser = await GoogleUser.findById(id);
    if (!googleUser) {
      // If user is not found, pass null as the user
      return done(null, null);
    }
    done(null, googleUser);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
