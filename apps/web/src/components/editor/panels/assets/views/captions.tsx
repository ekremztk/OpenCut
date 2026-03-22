"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { extractTimelineAudio } from "@/lib/media/mediabunny";
import { decodeAudioToFloat32 } from "@/lib/media/audio";
import { useEditor } from "@/hooks/use-editor";
import { DEFAULT_TEXT_ELEMENT } from "@/constants/text-constants";
import { TRANSCRIPTION_LANGUAGES } from "@/constants/transcription-constants";
import { transcriptionService } from "@/services/transcription/service";
import { transcribeWithDeepgram } from "@/services/transcription/deepgram-service";
import {
	buildCaptionChunks,
	buildCaptionChunksFromWords,
} from "@/lib/transcription/caption";
import { captionChunksToSrt, downloadSrt } from "@/lib/transcription/srt";
import type { CaptionChunk, TranscriptionLanguage } from "@/types/transcription";
import { Cloud, Cpu, Download, CheckCheck, RotateCcw } from "lucide-react";
import { cn } from "@/utils/ui";

type Engine = "deepgram" | "whisper";

const CHAR_OPTIONS = [
	{ label: "Short (20)", value: 20 },
	{ label: "Medium (32)", value: 32 },
	{ label: "Long (42)", value: 42 },
];

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Captions() {
	const editor = useEditor();

	const [engine, setEngine] = useState<Engine>("deepgram");
	const [language, setLanguage] = useState<TranscriptionLanguage>("auto");
	const [maxChars, setMaxChars] = useState(32);
	const [maxLines, setMaxLines] = useState<1 | 2>(1);

	const [isProcessing, setIsProcessing] = useState(false);
	const [processingStep, setProcessingStep] = useState("");
	const [error, setError] = useState<string | null>(null);

	const [captions, setCaptions] = useState<CaptionChunk[] | null>(null);
	const [applied, setApplied] = useState(false);

	const containerRef = useRef<HTMLDivElement>(null);

	const reset = () => {
		setCaptions(null);
		setApplied(false);
		setError(null);
	};

	const handleGenerate = async () => {
		try {
			setIsProcessing(true);
			setError(null);
			setCaptions(null);
			setApplied(false);
			setProcessingStep("Extracting audio from timeline...");

			const audioBlob = await extractTimelineAudio({
				tracks: editor.timeline.getTracks(),
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			let chunks: CaptionChunk[] = [];

			if (engine === "deepgram") {
				const result = await transcribeWithDeepgram({
					audioBlob,
					language: language === "auto" ? undefined : language,
					onProgress: setProcessingStep,
				});

				setProcessingStep("Building captions...");

				if (result.words && result.words.length > 0) {
					chunks = buildCaptionChunksFromWords({
						words: result.words,
						maxCharsPerLine: maxChars,
						maxLines,
					});
				} else {
					chunks = buildCaptionChunks({ segments: result.segments });
				}
			} else {
				setProcessingStep("Loading Whisper model...");
				const { samples } = await decodeAudioToFloat32({ audioBlob });

				const result = await transcriptionService.transcribe({
					audioData: samples,
					language: language === "auto" ? undefined : language,
					onProgress: (p) => {
						if (p.status === "loading-model") {
							setProcessingStep(`Loading model ${Math.round(p.progress)}%`);
						} else {
							setProcessingStep("Transcribing...");
						}
					},
				});

				setProcessingStep("Building captions...");
				chunks = buildCaptionChunks({ segments: result.segments });
			}

			setCaptions(chunks);
		} catch (err) {
			console.error("[Captions]", err);
			setError(err instanceof Error ? err.message : "Unexpected error");
		} finally {
			setIsProcessing(false);
			setProcessingStep("");
		}
	};

	const handleApply = () => {
		if (!captions || captions.length === 0) return;

		const trackId = editor.timeline.addTrack({ type: "text", index: 0 });

		for (let i = 0; i < captions.length; i++) {
			const caption = captions[i];
			editor.timeline.insertElement({
				placement: { mode: "explicit", trackId },
				element: {
					...DEFAULT_TEXT_ELEMENT,
					name: `Caption ${i + 1}`,
					content: caption.text,
					duration: caption.duration,
					startTime: caption.startTime,
					fontSize: 32,
					fontWeight: "bold",
					textAlign: "center",
				},
			});
		}

		setApplied(true);
	};

	const handleDownloadSrt = () => {
		if (!captions || captions.length === 0) return;
		const srtContent = captionChunksToSrt(captions);
		downloadSrt(srtContent, "subtitles.srt");
	};

	return (
		<ScrollArea className="h-full scrollbar-hidden">
			<div ref={containerRef} className="flex flex-col gap-5 p-4">

				{/* Engine selector */}
				<div>
					<Label className="mb-2 block">Transcription Engine</Label>
					<div className="grid grid-cols-2 gap-2">
						{(["deepgram", "whisper"] as Engine[]).map((e) => (
							<button
								key={e}
								onClick={() => { setEngine(e); reset(); }}
								className={cn(
									"flex flex-col items-center gap-1.5 rounded-md border p-3 text-xs font-medium transition-colors",
									engine === e
										? "border-primary bg-primary/10 text-primary"
										: "border-border text-muted-foreground hover:border-muted-foreground"
								)}
							>
								{e === "deepgram"
									? <Cloud className="size-4" />
									: <Cpu className="size-4" />
								}
								{e === "deepgram" ? "Deepgram (Cloud)" : "Whisper (Local)"}
							</button>
						))}
					</div>
					{engine === "deepgram" && (
						<p className="text-muted-foreground mt-2 text-xs">
							Faster, more accurate. Uses Prognot backend.
						</p>
					)}
					{engine === "whisper" && (
						<p className="text-muted-foreground mt-2 text-xs">
							Runs in browser. Downloads model on first use (~150MB).
						</p>
					)}
				</div>

				{/* Language */}
				<div>
					<Label className="mb-2 block">Language</Label>
					<Select
						value={language}
						onValueChange={(v) => setLanguage(v as TranscriptionLanguage)}
					>
						<SelectTrigger>
							<SelectValue placeholder="Select language" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="auto">Auto detect</SelectItem>
							{TRANSCRIPTION_LANGUAGES.map((l) => (
								<SelectItem key={l.code} value={l.code}>
									{l.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{/* Max chars per line + line count (Deepgram only) */}
				{engine === "deepgram" && (
					<>
						<div>
							<Label className="mb-2 block">Characters per line</Label>
							<div className="grid grid-cols-3 gap-2">
								{CHAR_OPTIONS.map((opt) => (
									<button
										key={opt.value}
										onClick={() => setMaxChars(opt.value)}
										className={cn(
											"rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
											maxChars === opt.value
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-muted-foreground hover:border-muted-foreground"
										)}
									>
										{opt.label}
									</button>
								))}
							</div>
						</div>

						<div>
							<Label className="mb-2 block">Lines per subtitle</Label>
							<div className="grid grid-cols-2 gap-2">
								{([1, 2] as const).map((n) => (
									<button
										key={n}
										onClick={() => setMaxLines(n)}
										className={cn(
											"rounded-md border py-1.5 text-xs font-medium transition-colors",
											maxLines === n
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-muted-foreground hover:border-muted-foreground"
										)}
									>
										{n === 1 ? "1 line" : "2 lines"}
									</button>
								))}
							</div>
						</div>
					</>
				)}

				{/* Error */}
				{error && (
					<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
						<p className="text-destructive text-sm">{error}</p>
					</div>
				)}

				{/* Generate button */}
				{!captions && (
					<Button
						className="w-full"
						onClick={handleGenerate}
						disabled={isProcessing}
					>
						{isProcessing && <Spinner className="mr-2" />}
						{isProcessing ? processingStep : "Generate Subtitles"}
					</Button>
				)}

				{/* Caption preview + actions */}
				{captions && captions.length > 0 && (
					<div className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<p className="text-sm font-medium">{captions.length} subtitles generated</p>
							<button
								onClick={reset}
								className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
							>
								<RotateCcw className="size-3" /> Redo
							</button>
						</div>

						<div className="border-border max-h-52 overflow-y-auto rounded-md border">
							{captions.map((chunk, i) => (
								<div
									key={i}
									className={cn(
										"border-border px-3 py-2 text-xs",
										i < captions.length - 1 && "border-b"
									)}
								>
									<span className="text-muted-foreground mr-2 font-mono">
										{formatTime(chunk.startTime)}
									</span>
									<span>{chunk.text}</span>
								</div>
							))}
						</div>

						<Button
							className="w-full"
							onClick={handleApply}
							disabled={applied}
						>
							{applied ? (
								<><CheckCheck className="mr-2 size-4" /> Applied to Timeline</>
							) : (
								"Apply to Timeline"
							)}
						</Button>

						{applied && (
							<p className="text-muted-foreground text-center text-xs">
								Click a caption in the timeline to edit it. Use Track mode to style all at once.
							</p>
						)}

						<Button
							variant="outline"
							className="w-full"
							onClick={handleDownloadSrt}
						>
							<Download className="mr-2 size-4" />
							Download .srt
						</Button>
					</div>
				)}

			</div>
		</ScrollArea>
	);
}
