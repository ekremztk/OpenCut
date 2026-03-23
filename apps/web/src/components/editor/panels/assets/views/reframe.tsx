"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/hooks/use-editor";
import { runReframe, type ReframeProgress, type ReframeResult } from "@/lib/reframe/engine";
import { CheckCheck, RotateCcw, Smartphone } from "lucide-react";

export function ReframeView() {
	const editor = useEditor();

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState<ReframeProgress | null>(null);
	const [results, setResults] = useState<ReframeResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const reset = () => {
		setResults(null);
		setError(null);
		setProgress(null);
	};

	const handleReframe = async () => {
		try {
			setIsProcessing(true);
			setError(null);
			setResults(null);

			const res = await runReframe(editor, (p) => setProgress(p));
			setResults(res);
		} catch (err) {
			console.error("[Reframe]", err);
			setError(err instanceof Error ? err.message : "Unexpected error");
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<ScrollArea className="h-full scrollbar-hidden">
			<div className="flex flex-col gap-5 p-4">

				{/* Description */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<Smartphone className="size-4 text-primary" />
						<span className="text-sm font-medium">Reframe to 9:16</span>
					</div>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Converts your clip to vertical format using AI face detection and
						speaker diarization. Automatically follows the active speaker with
						smooth transitions and hard cuts at scene changes.
					</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Processing runs on the server — the result will appear in your
						<strong> Media panel</strong> when ready.
					</p>
				</div>

				{/* Error */}
				{error && (
					<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
						<p className="text-destructive text-sm">{error}</p>
					</div>
				)}

				{/* Reframe button */}
				{!results && (
					<Button
						className="w-full"
						onClick={handleReframe}
						disabled={isProcessing}
					>
						{isProcessing && <Spinner className="mr-2" />}
						{isProcessing
							? (progress?.step ?? "Processing...")
							: "Reframe to 9:16"}
					</Button>
				)}

				{/* Progress bar */}
				{isProcessing && progress && (
					<div className="flex flex-col gap-1.5">
						<div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
							<div
								className="bg-primary h-full rounded-full transition-all duration-500"
								style={{ width: `${progress.percent}%` }}
							/>
						</div>
						<p className="text-muted-foreground text-center text-xs">
							{progress.percent}%
						</p>
					</div>
				)}

				{/* Result */}
				{results && results.length > 0 && (
					<div className="flex flex-col gap-3">
						<div className="bg-primary/10 border-primary/20 flex items-start gap-3 rounded-md border p-3">
							<CheckCheck className="text-primary mt-0.5 size-4 shrink-0" />
							<div className="flex flex-col gap-0.5">
								<p className="text-sm font-medium">9:16 video ready!</p>
								<p className="text-muted-foreground text-xs">
									{results.length} video{results.length > 1 ? "s" : ""} added to your Media panel.
									Drag to the timeline to use.
								</p>
							</div>
						</div>

						<button
							onClick={reset}
							className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 text-xs transition-colors"
						>
							<RotateCcw className="size-3" /> Run again
						</button>
					</div>
				)}

			</div>
		</ScrollArea>
	);
}
