import { Router } from 'express';

import Paths from '@src/common/constants/Paths';
import UserRoutes from './UserRoutes';

import templatesRouter from './templates';
import qaRouter from './qa';
import qaAdvancedRouter from './qa-advanced';
import organizationRouter from './organization.routes';
import documentToPromptRouter from './documentToPrompt';
// templateGenerationRouter is mounted directly in server.ts, not here

/******************************************************************************
                                Setup
******************************************************************************/

// Root API router (mounted at /api in server.ts)
const apiRouter = Router();

/** Users */
const userRouter = Router();
userRouter.get(Paths.Users.Get, UserRoutes.getAll);
userRouter.post(Paths.Users.Add, UserRoutes.add);
userRouter.put(Paths.Users.Update, UserRoutes.update);
userRouter.delete(Paths.Users.Delete, UserRoutes.delete);
apiRouter.use(Paths.Users.Base, userRouter);

/** Feature routers */
apiRouter.use('/templates', templatesRouter);       // → /api/templates/...
apiRouter.use('/qa', qaRouter);                      // → /api/qa/...
apiRouter.use('/qa-advanced', qaAdvancedRouter);     // → /api/qa-advanced/...
apiRouter.use('/organizations', organizationRouter); // → /api/organizations/...
apiRouter.use('/', documentToPromptRouter);          // → /api/csv-to-prompt
// Note: /generate router is mounted directly in server.ts

/******************************************************************************
                                Export default
******************************************************************************/
export default apiRouter;
