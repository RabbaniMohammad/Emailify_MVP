import passport from 'passport';
import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import User, { IUser } from '@src/models/User';
import logger from 'jet-logger';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || '';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
  logger.err('Missing Google OAuth environment variables');
  process.exit(1);
}

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
      passReqToCallback: true, // Enable access to req object
    },
    async (
      req: any,
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        logger.info(`Google OAuth callback for: ${profile.emails?.[0]?.value}`);

        const googleId = profile.id;
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const picture = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('No email provided by Google'), undefined);
        }

        // Get organization slug from state parameter
        const orgSlug = (req.query.state as string) || '';
        
        if (!orgSlug) {
          // No org specified - this shouldn't happen with the new flow
          logger.warn(`⚠️ No organization specified for login: ${email}`);
          return done(new Error('Organization is required'), undefined);
        }

        // Find or create organization first
        const Organization = (await import('@src/models/Organization')).default;
        let organization = await Organization.findOne({ slug: orgSlug.toLowerCase() });
        
        if (!organization) {
          // Create new organization (will be handled properly in callback)
          // For now, just pass user data back
          logger.info(`🏢 New organization will be created: ${orgSlug}`);
        }

        const organizationId = organization?._id;

        // Look for existing user in THIS organization
        let user = await User.findOne({ 
          googleId,
          organizationId: organizationId || null
        });

        if (user) {
          // Existing user in this org - update info
          logger.info(`✅ Existing user in org ${orgSlug}: ${email}`);
          user.name = name;
          user.picture = picture;
          await user.updateLastLogin();
          return done(null, user);
        } else {
          // New user in this org - create minimal record (org assignment happens in callback)
          logger.info(`🆕 New user for org ${orgSlug}: ${email}`);
          
          // If org exists, create user in that org
          if (organizationId) {
            user = await User.create({
              googleId,
              email,
              name,
              picture,
              organizationId,
              orgRole: 'member', // Default role, will be updated in callback if first user
              isApproved: false,
              isActive: true,
            });
          } else {
            // Org doesn't exist yet - create user without org (will be assigned in callback)
            user = await User.create({
              googleId,
              email,
              name,
              picture,
              orgRole: 'member',
              isApproved: false,
              isActive: true,
            });
          }
          
          return done(null, user);
        }
      } catch (error) {
        logger.err('Google OAuth error:', error);
        return done(error as Error, undefined);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;