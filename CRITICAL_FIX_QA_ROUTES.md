# CRITICAL SECURITY FIX: QA Routes Organization Isolation

## Issue
The QA routes (`/api/qa/*` and `/api/qa-advanced/*`) are missing authentication and organization isolation middleware, allowing unauthenticated access to grammar checking and template editing features.

## Security Risks
1. **Unauthenticated Access**: Anyone can use QA features without logging in
2. **Data Leakage**: Users could potentially access templates from other organizations
3. **Resource Abuse**: Unlimited OpenAI API calls without rate limiting
4. **Cross-Organization Access**: No validation that template belongs to user's organization

## Required Changes

### File: `backend/src/routes/qa.ts`

Add authentication and organization context middleware to ALL routes:

```typescript
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';
import rateLimit from 'express-rate-limit';

// Add rate limiter for QA routes (prevents API abuse)
const qaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each user to 20 QA requests per 15 minutes
  message: 'Too many QA requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// BEFORE (VULNERABLE):
router.post('/:id/golden', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  // ... no auth check
});

// AFTER (SECURE):
router.post('/:id/golden', 
  authenticate, 
  organizationContext, 
  qaLimiter,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    const userId = (req as any).tokenPayload?.userId;
    
    // Validate template belongs to user's organization
    if (id.startsWith('gen_') || id.startsWith('Generated_')) {
      const template = await GeneratedTemplate.findOne({ 
        templateId: id,
        organizationId: organization._id
      });
      
      if (!template) {
        return res.status(404).json({ 
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied' 
        });
      }
    }
    
    // ... rest of logic
  }
);
```

### Apply to ALL QA Routes

Update these endpoints in `qa.ts`:
- ✅ `POST /:id/golden`
- ✅ `POST /:id/atomic-edit`
- ✅ `POST /:id/single-atomic`
- ✅ `POST /:id/custom-atomic`
- ✅ `POST /:id/hybrid`
- ✅ Any other QA endpoints

### File: `backend/src/routes/qa-advanced.ts`

Apply the same fixes:

```typescript
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';

router.post('/:id/golden', 
  authenticate, 
  organizationContext,
  async (req: Request, res: Response) => {
    const organization = (req as any).organization;
    
    // Validate template ownership
    if (id.startsWith('gen_')) {
      const template = await GeneratedTemplate.findOne({ 
        templateId: id,
        organizationId: organization._id
      });
      
      if (!template) {
        return res.status(404).json({ 
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied' 
        });
      }
    }
    
    // ... rest of logic
  }
);
```

## Validation Checklist

After applying fixes, verify:

1. ✅ All QA routes require authentication
2. ✅ All QA routes validate organization context
3. ✅ Template lookups filter by `organizationId`
4. ✅ Rate limiting prevents abuse
5. ✅ Error messages don't leak sensitive information
6. ✅ Audit logging tracks QA usage

## Testing

### Test 1: Unauthenticated Access (Should Fail)
```bash
curl -X POST http://localhost:3000/api/qa/gen_123/golden \
  -H "Content-Type: application/json" \
  -d '{"html": "<h1>Test</h1>"}'

# Expected: 401 Unauthorized
```

### Test 2: Cross-Organization Access (Should Fail)
```javascript
// User from Org A tries to access template from Org B
fetch('/api/qa/gen_org_b_template/golden', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <org_a_token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ html: '<h1>Test</h1>' })
});

// Expected: 404 Template not found or access denied
```

### Test 3: Valid Access (Should Succeed)
```javascript
// User from Org A accesses their own template
fetch('/api/qa/gen_org_a_template/golden', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <org_a_token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ html: '<h1>Test</h1>' })
});

// Expected: 200 OK with corrections
```

### Test 4: Rate Limiting (Should Block After 20 Requests)
```javascript
// Make 21 requests within 15 minutes
for (let i = 0; i < 21; i++) {
  await fetch('/api/qa/gen_template/golden', { ... });
}

// Expected: 429 Too Many Requests on 21st request
```

## Deployment Steps

1. Install rate limiting package:
```bash
cd backend
npm install express-rate-limit
```

2. Apply code changes to `qa.ts` and `qa-advanced.ts`

3. Test in development environment

4. Deploy to production with monitoring

5. Monitor logs for any authentication errors

## Rollback Plan

If issues occur, you can temporarily:
1. Remove rate limiting (keep authentication)
2. Increase rate limit temporarily
3. Add logging to debug authentication issues

Do NOT remove authentication middleware - this is a critical security fix.

## Impact Assessment

- **Breaking Changes**: NO - Frontend already sends auth tokens
- **Performance Impact**: Minimal - adds ~5ms per request for auth validation
- **User Experience**: No change - users are already authenticated
- **Risk**: Very Low - authentication middleware is battle-tested

## Timeline

- **Immediate**: Apply fixes to qa.ts and qa-advanced.ts
- **Day 1**: Test in development
- **Day 2**: Deploy to production
- **Week 1**: Monitor for any issues

## Contact

For questions, contact the security team or backend lead.
