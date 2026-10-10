import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminLibraryRouter from "./admin-library";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin", adminLibraryRouter);

export default router;
