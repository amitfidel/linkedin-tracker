import { db } from "./index";
import { scheduleConfig } from "./schema";

// Seed default schedule config if not exists
const existing = db.select().from(scheduleConfig).get();
if (!existing) {
  db.insert(scheduleConfig)
    .values({
      id: 1,
      cronExpression: "0 2 * * 1", // Monday 2 AM
      isEnabled: true,
    })
    .run();
  console.log("Seeded default schedule config");
} else {
  console.log("Schedule config already exists");
}

console.log("Seed complete");
