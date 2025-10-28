"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Paths_1 = __importDefault(require("@src/common/constants/Paths"));
const UserRoutes_1 = __importDefault(require("./UserRoutes"));
const templates_1 = __importDefault(require("./templates"));
const qa_1 = __importDefault(require("./qa"));
const organization_routes_1 = __importDefault(require("./organization.routes"));
/******************************************************************************
                                Setup
******************************************************************************/
// Root API router (mounted at /api in server.ts)
const apiRouter = (0, express_1.Router)();
/** Users */
const userRouter = (0, express_1.Router)();
userRouter.get(Paths_1.default.Users.Get, UserRoutes_1.default.getAll);
userRouter.post(Paths_1.default.Users.Add, UserRoutes_1.default.add);
userRouter.put(Paths_1.default.Users.Update, UserRoutes_1.default.update);
userRouter.delete(Paths_1.default.Users.Delete, UserRoutes_1.default.delete);
apiRouter.use(Paths_1.default.Users.Base, userRouter);
/** Feature routers */
apiRouter.use('/templates', templates_1.default); // → /api/templates/...
apiRouter.use('/qa', qa_1.default); // → /api/qa/...
apiRouter.use('/organizations', organization_routes_1.default); // → /api/organizations/...
/******************************************************************************
                                Export default
******************************************************************************/
exports.default = apiRouter;
