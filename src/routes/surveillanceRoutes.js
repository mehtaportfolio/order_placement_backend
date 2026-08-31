import express from "express";
import {
  getStockSurveillance,
  getSurveillanceDashboard,
  checkSurveillanceRestriction,
} from "../controllers/surveillanceController.js";

const router = express.Router();

router.get('/dashboard', getSurveillanceDashboard);
router.get('/check/:stock_name', checkSurveillanceRestriction);
router.get('/:stock_name', getStockSurveillance);

export default router;