import { Request, Response, NextFunction } from 'express';
import Organization from '@src/models/Organization';
import User from '@src/models/User';
import logger from 'jet-logger';

/**
 * Strict middleware to validate organization access from URL parameters.
 * Ensures users can ONLY access resources from their own organization.
 * 
 * SECURITY: Prevents cross-organization access by validating that the
 * organizationId from the JWT token matches the :id parameter in the URL.
 * 
 * Must be used AFTER authenticate middleware.
 * Requires route to have :id parameter representing organizationId.
 * 
 * Usage:
 * router.get('/:id/campaigns', authenticate, strictOrganizationAccess, async (req, res) => {...});
 */
export const strictOrganizationAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params; // Organization ID from URL
    const tokenPayload = (req as any).tokenPayload;
    
    if (!tokenPayload) {
      logger.warn('🚫 [SECURITY] strictOrganizationAccess: No token payload');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { userId, organizationId: tokenOrgId } = tokenPayload;
    
    if (!tokenOrgId) {
      logger.warn(`🚫 [SECURITY] User ${userId} has no organizationId in token`);
      res.status(403).json({ 
        error: 'No organization assigned',
        message: 'Your account is not associated with any organization.'
      });
      return;
    }

    // CRITICAL SECURITY CHECK: User can only access their own organization
    if (tokenOrgId.toString() !== id) {
      logger.warn(`🚫 [SECURITY] Cross-org access attempt: User from org ${tokenOrgId} tried to access org ${id}`);
      res.status(403).json({ 
        error: 'Access denied',
        message: 'You can only access your own organization\'s resources'
      });
      return;
    }

    // Verify organization exists and is active
    const organization = await Organization.findById(id);
    
    if (!organization) {
      logger.warn(`🚫 [SECURITY] Organization not found: ${id}`);
      res.status(404).json({ 
        error: 'Organization not found',
        message: 'The requested organization does not exist'
      });
      return;
    }

    if (!organization.isActive) {
      logger.warn(`🚫 [SECURITY] Inactive organization access attempt: ${id}`);
      res.status(403).json({ 
        error: 'Organization inactive',
        message: 'This organization has been deactivated'
      });
      return;
    }

    // Attach organization to request for use in routes
    (req as any).organization = organization;
    
    logger.info(`✅ [SECURITY] Organization access granted: ${organization.name} (${id})`);
    next();
  } catch (error) {
    logger.err('❌ [SECURITY] Organization validation error:', error);
    res.status(500).json({ 
      error: 'Organization validation failed',
      message: 'An error occurred while validating organization access'
    });
  }
};
