import { createClient } from "@/lib/supabase/server";

export async function getServerSession() {
	const supabase = await createClient();
	const { data } = await supabase.auth.getUser();
	return data.user;
}
