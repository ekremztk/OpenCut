import type { TranscriptionSegment, TranscriptionWord, CaptionChunk } from "@/types/transcription";
import {
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/constants/transcription-constants";

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments) {
		const words = segment.text.trim().split(/\s+/);
		if (words.length === 0 || (words.length === 1 && words[0] === "")) continue;

		const segmentDuration = segment.end - segment.start;
		const wordsPerSecond = words.length / segmentDuration;

		const chunks: string[] = [];
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
		}

		let chunkStartTime = segment.start;
		for (const chunk of chunks) {
			const chunkWords = chunk.split(/\s+/).length;
			const chunkDuration = Math.max(minDuration, chunkWords / wordsPerSecond);
			const adjustedStartTime = Math.max(chunkStartTime, globalEndTime);

			captions.push({
				text: chunk,
				startTime: adjustedStartTime,
				duration: chunkDuration,
			});

			globalEndTime = adjustedStartTime + chunkDuration;
			chunkStartTime += chunkDuration;
		}
	}

	return captions;
}

/**
 * Builds caption chunks from word-level timestamps (Deepgram output).
 * Groups words by character limit — more precise than segment-based chunking.
 */
export function buildCaptionChunksFromWords({
	words,
	maxCharsPerLine = 42,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	words: TranscriptionWord[];
	maxCharsPerLine?: number;
	minDuration?: number;
}): CaptionChunk[] {
	if (!words || words.length === 0) return [];

	const chunks: CaptionChunk[] = [];
	let currentWords: TranscriptionWord[] = [];
	let currentChars = 0;

	const flush = () => {
		if (currentWords.length === 0) return;
		const text = currentWords.map((w) => w.punctuated_word || w.word).join(" ");
		const startTime = currentWords[0].start;
		const endTime = currentWords[currentWords.length - 1].end;
		const duration = Math.max(minDuration, endTime - startTime);
		chunks.push({ text, startTime, duration });
		currentWords = [];
		currentChars = 0;
	};

	for (const word of words) {
		const wordText = word.punctuated_word || word.word;
		const addedChars = currentChars === 0 ? wordText.length : wordText.length + 1; // +1 for space

		if (currentChars > 0 && currentChars + addedChars > maxCharsPerLine) {
			flush();
		}

		currentWords.push(word);
		currentChars += addedChars;
	}

	flush();
	return chunks;
}
