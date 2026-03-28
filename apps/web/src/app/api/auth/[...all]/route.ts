// Auth is handled by Supabase — this route is no longer used
export function GET() {
	return new Response(JSON.stringify({ ok: true }), {
		headers: { "Content-Type": "application/json" },
	});
}
