import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import User, { IUser } from '@src/models/User';
import logger from 'jet-logger';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
  logger.err('❌ Missing Google OAuth environment variables');
  process.exit(1);
}

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        logger.info(`🔐 Google OAuth callback for: ${profile.emails?.[0]?.value}`);

        // Extract profile data
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const picture = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('No email provided by Google'), undefined);
        }

        // Find or create user
        let user = await User.findOne({ googleId });

        if (user) {
          // Update existing user
          logger.info(`👤 Existing user logged in: ${email}`);
          user.name = name;
          user.picture = picture;
          await user.updateLastLogin();
        } else {
          // Create new user
          logger.info(`🆕 Creating new user: ${email}`);
          user = await User.create({
            googleId,
            email,
            name,
            picture,
          });
        }

        return done(null, user);
      } catch (error) {
        logger.err('❌ Google OAuth error:', error);
        return done(error as Error, undefined);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;