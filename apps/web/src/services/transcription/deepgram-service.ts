import type { TranscriptionResult, TranscriptionSegment } from "@/types/transcription";

const PROGNOT_API = process.env.NEXT_PUBLIC_PROGNOT_API_URL || "http://localhost:8000";

export interface DeepgramWord {
	word: string;
	punctuated_word: string;
	start: number;
	end: number;
	confidence: number;
}

export interface DeepgramTranscriptionResult extends TranscriptionResult {
	words: DeepgramWord[];
}

/**
 * Sends audio blob to the Prognot backend for transcription via Deepgram.
 * Returns segments + word-level timestamps.
 */
export async function transcribeWithDeepgram({
	audioBlob,
	language,
	onProgress,
}: {
	audioBlob: Blob;
	language?: string;
	onProgress?: (message: string) => void;
}): Promise<DeepgramTranscriptionResult> {
	onProgress?.("Sending audio to Deepgram...");

	const formData = new FormData();
	formData.append("audio", audioBlob, "timeline-audio.wav");
	if (language && language !== "auto") {
		formData.append("language", language);
	}

	const response = await fetch(`${PROGNOT_API}/captions/generate`, {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`Transcription failed (${response.status}): ${detail}`);
	}

	onProgress?.("Processing results...");

	const data = await response.json();

	return {
		text: data.text ?? "",
		segments: (data.segments ?? []) as TranscriptionSegment[],
		words: (data.words ?? []) as DeepgramWord[],
		language: data.language ?? "auto",
	};
}
