import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getR2Client() {
	return new S3Client({
		region: "auto",
		endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID!,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
		},
	});
}

// GET /api/media?project_id=xxx — list media assets for a project
export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const project_id = searchParams.get("project_id");
		if (!project_id) return NextResponse.json({ error: "Missing project_id" }, { status: 400 });

		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const { data, error } = await supabase
			.from("editor_media_assets")
			.select("*")
			.eq("project_id", project_id)
			.eq("user_id", user.id);

		if (error) throw error;

		// Attach public URL to each asset
		const r2BaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "";
		const assetsWithUrl = (data ?? []).map((asset) => ({
			...asset,
			public_url: `${r2BaseUrl}/${asset.r2_key}`,
		}));

		return NextResponse.json(assetsWithUrl);
	} catch (err) {
		console.error("[API /media] GET error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

// POST /api/media — generate presigned upload URL + create DB record
export async function POST(request: Request) {
	try {
		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		const body = await request.json();
		const { project_id, name, type, size, width, height, duration, fps, content_type } = body;

		if (!project_id || !name || !type || !content_type) {
			return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
		}

		// Verify project belongs to user
		const { data: project } = await supabase
			.from("editor_projects")
			.select("id")
			.eq("id", project_id)
			.eq("user_id", user.id)
			.single();

		if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

		// Generate R2 key
		const ext = name.split(".").pop() ?? "bin";
		const r2_key = `editor/${user.id}/${project_id}/${crypto.randomUUID()}.${ext}`;

		// Create DB record
		const { data: asset, error: dbError } = await supabase
			.from("editor_media_assets")
			.insert({
				user_id: user.id,
				project_id,
				name,
				type,
				size,
				width,
				height,
				duration,
				fps,
				r2_key,
			})
			.select()
			.single();

		if (dbError) throw dbError;

		// Generate presigned upload URL (15 min expiry)
		const r2 = getR2Client();
		const cmd = new PutObjectCommand({
			Bucket: process.env.R2_BUCKET_NAME!,
			Key: r2_key,
			ContentType: content_type,
		});
		const upload_url = await getSignedUrl(r2, cmd, { expiresIn: 900 });

		// Public read URL
		const public_url = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${r2_key}`;

		return NextResponse.json({ asset, upload_url, public_url }, { status: 201 });
	} catch (err) {
		console.error("[API /media] POST error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

// DELETE /api/media?id=xxx — delete media asset + R2 file
export async function DELETE(request: Request) {
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get("id");
		if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

		const supabase = await createClient();
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

		// Get asset to find r2_key
		const { data: asset } = await supabase
			.from("editor_media_assets")
			.select("r2_key")
			.eq("id", id)
			.eq("user_id", user.id)
			.single();

		if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

		// Delete from R2
		const r2 = getR2Client();
		await r2.send(new DeleteObjectCommand({
			Bucket: process.env.R2_BUCKET_NAME!,
			Key: asset.r2_key,
		}));

		// Delete from DB
		await supabase.from("editor_media_assets").delete().eq("id", id).eq("user_id", user.id);

		return NextResponse.json({ deleted: true });
	} catch (err) {
		console.error("[API /media] DELETE error:", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
