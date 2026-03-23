"use client";

import { useEditor } from "@/hooks/use-editor";
import { useYouTubeStore } from "@/stores/youtube-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Copy, Check, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			toast.success("Copied!");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Copy failed");
		}
	};

	return (
		<button
			onClick={handleCopy}
			className="text-muted-foreground hover:text-foreground transition-colors"
			title="Copy"
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</button>
	);
}

export function YouTubeView() {
	const editor = useEditor();
	const activeProject = editor.project.getActiveOrNull();
	const { title, description, guestName, setTitle, setDescription, setGuestName } = useYouTubeStore();

	const [isGenerating, setIsGenerating] = useState(false);
	const [prevState, setPrevState] = useState<{ title: string; description: string } | null>(null);

	if (!activeProject) return null;

	const handleGenerate = async () => {
		try {
			setIsGenerating(true);
			setPrevState({ title, description });

			const apiBase = process.env.NEXT_PUBLIC_PROGNOT_API_URL ?? "";
			const res = await fetch(`${apiBase}/youtube-metadata/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					description,
					guest_name: guestName || null,
				}),
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const data = await res.json();
			if (data.title) setTitle(data.title);
			if (data.description) setDescription(data.description);
			toast.success("Title and description updated!");
		} catch (err) {
			console.error("[YouTubeView] Generate error:", err);
			toast.error("Failed to generate metadata");
			setPrevState(null);
		} finally {
			setIsGenerating(false);
		}
	};

	const handleUndo = () => {
		if (!prevState) return;
		setTitle(prevState.title);
		setDescription(prevState.description);
		setPrevState(null);
		toast.success("Reverted to previous title and description");
	};

	return (
		<ScrollArea className="h-full scrollbar-hidden">
			<div className="flex flex-col gap-5 p-4">
				<div>
					<p className="text-muted-foreground text-xs mb-4 leading-relaxed">
						AI-generated YouTube metadata for this clip. Edit freely — changes are saved automatically.
					</p>
				</div>

				{/* Title */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<label className="text-xs font-medium text-foreground">Title</label>
						<CopyButton text={title} />
					</div>
					<input
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Enter YouTube title..."
						maxLength={100}
						className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<p className="text-muted-foreground text-right text-xs">{title.length}/100</p>
				</div>

				{/* Description */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<label className="text-xs font-medium text-foreground">Description</label>
						<CopyButton text={description} />
					</div>
					<textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Enter YouTube description..."
						rows={8}
						className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					<p className="text-muted-foreground text-right text-xs">{description.length} chars</p>
				</div>

				{/* Guest Name */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<label className="text-xs font-medium text-foreground">Guest Name</label>
						<CopyButton text={guestName} />
					</div>
					<input
						type="text"
						value={guestName}
						onChange={(e) => setGuestName(e.target.value)}
						placeholder="Guest name (used for AI generation)..."
						className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					/>
				</div>

				{/* Generate + Undo */}
				<div className="flex gap-2">
					<Button
						className="flex-1 gap-2"
						onClick={handleGenerate}
						disabled={isGenerating}
					>
						{isGenerating ? (
							<Spinner className="size-3.5" />
						) : (
							<Sparkles className="size-3.5" />
						)}
						{isGenerating ? "Generating..." : "Generate with AI"}
					</Button>
					{prevState && (
						<Button
							variant="outline"
							size="icon"
							onClick={handleUndo}
							title="Undo AI generation"
						>
							<Undo2 className="size-4" />
						</Button>
					)}
				</div>

				{/* Copy All */}
				<Button
					variant="outline"
					size="sm"
					className="w-full"
					onClick={async () => {
						const text = `${title}\n\n${description}`;
						try {
							await navigator.clipboard.writeText(text);
							toast.success("Title + description copied!");
						} catch {
							toast.error("Copy failed");
						}
					}}
				>
					<Copy className="size-3.5 mr-2" />
					Copy All
				</Button>
			</div>
		</ScrollArea>
	);
}
