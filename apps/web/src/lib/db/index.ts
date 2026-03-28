import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { webEnv } from "@opencut/env/web";

let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
	if (!_db) {
		const url = webEnv.DATABASE_URL;
		if (!url) throw new Error("DATABASE_URL is not set");
		const client = postgres(url);
		_db = drizzle(client, { schema });
	}

	return _db;
}

export const db = getDb();

export * from "./schema";
