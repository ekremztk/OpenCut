"use client";

import { useEditor } from "@/hooks/use-editor";
import { useYouTubeStore } from "@/stores/youtube-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check } from "lucide-react";
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
	const { title, description, setTitle, setDescription } = useYouTubeStore();

	if (!activeProject) return null;

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
