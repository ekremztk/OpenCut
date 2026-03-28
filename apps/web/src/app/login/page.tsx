"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const supabase = createClient();
			const { error: authError } = await supabase.auth.signInWithPassword({
				email,
				password,
			});

			if (authError) {
				setError(authError.message);
				return;
			}

			router.push("/projects");
			router.refresh();
		} catch (err) {
			setError("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-background flex items-center justify-center">
			<div className="w-full max-w-sm px-6">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-semibold tracking-tight">Prognot Editor</h1>
					<p className="text-sm text-muted-foreground mt-1">Sign in to access your projects</p>
				</div>

				<form onSubmit={handleSignIn} className="space-y-4">
					<div>
						<label className="text-sm font-medium" htmlFor="email">
							Email
						</label>
						<input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							placeholder="you@example.com"
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<div>
						<label className="text-sm font-medium" htmlFor="password">
							Password
						</label>
						<input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							placeholder="••••••••"
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					{error && (
						<p className="text-sm text-destructive">{error}</p>
					)}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
					>
						{loading ? "Signing in..." : "Sign in"}
					</button>
				</form>

				<p className="mt-6 text-center text-xs text-muted-foreground">
					Use the same credentials as{" "}
					<a href="https://prognot.com" className="underline hover:text-foreground">
						prognot.com
					</a>
				</p>
			</div>
		</div>
	);
}
