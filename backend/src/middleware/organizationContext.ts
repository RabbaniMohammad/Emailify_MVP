import { Request, Response, NextFunction } from 'express';
import Organization from '@src/models/Organization';
import logger from 'jet-logger';

/**
 * Middleware to attach organization context to the request.
 * Must be used AFTER authenticate middleware.
 * Attaches req.organization and ensures user belongs to an active org.
 */
export const organizationContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const tokenPayload = (req as any).tokenPayload;
    
    if (!tokenPayload) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { organizationId, role } = tokenPayload;
    
    // 🔍 DEBUG: Log token payload
    logger.info(`🔍 [ORG_CONTEXT] User: ${tokenPayload.email}, OrgId: ${organizationId}, Role: ${role}`);

    // Super admins can bypass org checks (for debugging/support)
    if (role === 'super_admin') {
      (req as any).organization = null; // Super admin sees all
      (req as any).isSuperAdmin = true;
      logger.info('🔍 [ORG_CONTEXT] Super admin - bypass org filtering');
      next();
      return;
    }

    // Regular users must belong to an organization
    if (!organizationId) {
      logger.warn(`⚠️ [ORG_CONTEXT] User ${tokenPayload.email} has no organizationId in JWT token`);
      res.status(403).json({ 
        error: 'No organization assigned',
        message: 'Your account is not associated with any organization. Please contact support.'
      });
      return;
    }

    // Fetch organization details
    const organization = await Organization.findById(organizationId);
    
    if (!organization) {
      res.status(404).json({ 
        error: 'Organization not found',
        message: 'The organization associated with your account no longer exists.'
      });
      return;
    }

    if (!organization.isActive) {
      res.status(403).json({ 
        error: 'Organization inactive',
        message: 'Your organization has been deactivated. Please contact support.'
      });
      return;
    }

    // Attach organization to request for use in routes
    (req as any).organization = organization;
    (req as any).isSuperAdmin = false;
    
    logger.info(`✅ [ORG_CONTEXT] Organization: ${organization.name} (${organization.slug})`);
    next();
  } catch (error) {
    logger.err('Organization context error:', error);
    res.status(500).json({ error: 'Failed to load organization context' });
  }
};

/**
 * Optional organization context - doesn't fail if no org
 * Useful for public endpoints that show different data based on org
 */
export const optionalOrganizationContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const tokenPayload = (req as any).tokenPayload;
    
    if (!tokenPayload || !tokenPayload.organizationId) {
      next();
      return;
    }

    const organization = await Organization.findById(tokenPayload.organizationId);
    
    if (organization && organization.isActive) {
      (req as any).organization = organization;
    }
    
    next();
  } catch (error) {
    // Silently continue without org context
    next();
  }
};
