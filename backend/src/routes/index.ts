import { Router } from 'express';

import Paths from '@src/common/constants/Paths';
import UserRoutes from './UserRoutes';

import templatesRouter from './templates';
import qaRouter from './qa';

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
apiRouter.use('/templates', templatesRouter); // → /api/templates/...
apiRouter.use('/qa', qaRouter);               // → /api/qa/...

/******************************************************************************
                                Export default
******************************************************************************/
export default apiRouter;
