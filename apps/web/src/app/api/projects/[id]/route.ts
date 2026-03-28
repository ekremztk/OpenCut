import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const { data, error } = await supabase
			.from("editor_projects")
			.select("*")
			.eq("id", id)
			.eq("user_id", user.id)
			.single();

		if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
		return NextResponse.json(data);
	} catch (err) {
		console.error("[API /projects/[id]] GET error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const body = await request.json();
		const { name, thumbnail, duration, fps, canvas_width, canvas_height, project_data, project_version } = body;

		const { data, error } = await supabase
			.from("editor_projects")
			.update({
				...(name !== undefined && { name }),
				...(thumbnail !== undefined && { thumbnail }),
				...(duration !== undefined && { duration }),
				...(fps !== undefined && { fps }),
				...(canvas_width !== undefined && { canvas_width }),
				...(canvas_height !== undefined && { canvas_height }),
				...(project_data !== undefined && { project_data }),
				...(project_version !== undefined && { project_version }),
			})
			.eq("id", id)
			.eq("user_id", user.id)
			.select()
			.single();

		if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
		return NextResponse.json(data);
	} catch (err) {
		console.error("[API /projects/[id]] PUT error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const { error } = await supabase
			.from("editor_projects")
			.delete()
			.eq("id", id)
			.eq("user_id", user.id);

		if (error) throw error;
		return NextResponse.json({ deleted: true });
	} catch (err) {
		console.error("[API /projects/[id]] DELETE error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
