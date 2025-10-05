import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '@src/services/authService';
import User from '@src/models/User';

export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tokenPayload = (req as any).tokenPayload as TokenPayload | undefined;
      
      if (!tokenPayload) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const user = await User.findById(tokenPayload.userId);
      
      if (!user || !user.isActive || !user.isApproved) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (!allowedRoles.includes(user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      // Attach full user to request
      (req as any).currentUser = user;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
};

export const requireSuperAdmin = requireRole('super_admin');
export const requireAdmin = requireRole('super_admin', 'admin');