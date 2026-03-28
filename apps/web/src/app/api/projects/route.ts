import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
	try {
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const { data, error } = await supabase
			.from("editor_projects")
			.select("id, name, thumbnail, duration, fps, canvas_width, canvas_height, project_version, created_at, updated_at")
			.eq("user_id", user.id)
			.order("updated_at", { ascending: false });

		if (error) throw error;
		return NextResponse.json(data);
	} catch (err) {
		console.error("[API /projects] GET error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	try {
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const body = await request.json();
		const { name, fps, canvas_width, canvas_height, project_data, project_version } = body;

		const { data, error } = await supabase
			.from("editor_projects")
			.insert({
				user_id: user.id,
				name,
				fps: fps ?? 30,
				canvas_width: canvas_width ?? 1920,
				canvas_height: canvas_height ?? 1080,
				project_data: project_data ?? {},
				project_version: project_version ?? 9,
			})
			.select()
			.single();

		if (error) throw error;
		return NextResponse.json(data, { status: 201 });
	} catch (err) {
		console.error("[API /projects] POST error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
