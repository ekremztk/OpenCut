import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export default {
        schema: "./src/lib/db/schema.ts",
        dialect: "postgresql",
        migrations: {
                table: "drizzle_migrations",
        },
        dbCredentials: {
                url: process.env.DATABASE_URL!,
        },
        out: "./migrations",
} satisfies Config;
