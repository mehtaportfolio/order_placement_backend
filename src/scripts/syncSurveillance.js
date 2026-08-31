import dotenv from "dotenv";
import { runSurveillanceSync } from "../services/surveillance/surveillanceSyncRunner.js";

dotenv.config({ path: ".env.backend" });

async function syncSurveillance() {
  console.log("========== Surveillance Sync Started ==========");

  try {
    const result = await runSurveillanceSync();
    console.log("Surveillance sync result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Surveillance sync failed:", err?.message || err);
  }

  console.log("\n========== Surveillance Sync Completed ==========");
}

syncSurveillance();