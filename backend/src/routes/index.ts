import { Router } from 'express';

import Paths from '@src/common/constants/Paths';
import UserRoutes from './UserRoutes';

import templatesRouter from './templates';
import qaRouter from './qa';
import qaAdvancedRouter from './qa-advanced';
import organizationRouter from './organization.routes';
import documentToPromptRouter from './documentToPrompt';
import ideogramRouter from './ideogram.routes';
import multiChannelRouter from './multiChannel.routes';
import contentAdaptationRouter from './contentAdaptation.routes';
import testRouter from './test.routes';
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
apiRouter.use('/multi-channel', multiChannelRouter); // → /api/multi-channel/...
apiRouter.use('/content-adaptation', contentAdaptationRouter); // → /api/content-adaptation/...
apiRouter.use('/test', testRouter);                  // → /api/test/... (NO AUTH)
apiRouter.use('/', documentToPromptRouter);          // → /api/csv-to-prompt
apiRouter.use('/ideogram', ideogramRouter);          // → /api/ideogram/...
// Note: /generate router is mounted directly in server.ts

/******************************************************************************
                                Export default
******************************************************************************/
export default apiRouter;
