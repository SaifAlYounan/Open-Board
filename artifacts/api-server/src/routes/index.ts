import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import peopleRouter from "./people";
import boardsRouter from "./boards";
import meetingsRouter from "./meetings";
import votesRouter from "./votes";
import minutesRouter from "./minutes";
import documentsRouter from "./documents";
import tasksRouter from "./tasks";
import pendingActionsRouter from "./pendingActions";
import aiRouter from "./ai";
import dashboardRouter from "./dashboard";
import systemRouter from "./system";
import auditLogRouter from "./auditLog";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(peopleRouter);
router.use(boardsRouter);
router.use(meetingsRouter);
router.use(votesRouter);
router.use(minutesRouter);
router.use(documentsRouter);
router.use(tasksRouter);
router.use(pendingActionsRouter);
router.use(aiRouter);
router.use(dashboardRouter);
router.use(systemRouter);
router.use(auditLogRouter);

export default router;
