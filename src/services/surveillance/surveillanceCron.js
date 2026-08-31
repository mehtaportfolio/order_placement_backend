import cron from "node-cron";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export function startSurveillanceCron() {

  const scriptPath = path.join(
    __dirname,
    "../../scripts/syncSurveillance.js"
  );


  cron.schedule(
    "0 8 * * *",
    () => {

      console.log(
        "[Surveillance Cron] Starting daily sync..."
      );


      exec(
        `node ${scriptPath}`,
        (error, stdout, stderr) => {

          if (error) {

            console.error(
              "[Surveillance Cron] Error:",
              error.message
            );

            return;
          }


          if (stderr) {
            console.error(
              "[Surveillance Cron stderr]",
              stderr
            );
          }


          console.log(
            stdout
          );

        }
      );


    },
    {
      timezone: "Asia/Kolkata"
    }
  );


  console.log(
    "[Surveillance Cron] Scheduled at 8:00 AM daily"
  );

}