import type { TranscriptionSegment, TranscriptionWord, CaptionChunk } from "@/types/transcription";
import {
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/constants/transcription-constants";

function capOverlaps(captions: CaptionChunk[]): CaptionChunk[] {
	for (let i = 0; i < captions.length - 1; i++) {
		const nextStart = captions[i + 1].startTime;
		const end = captions[i].startTime + captions[i].duration;
		if (end > nextStart) {
			captions[i] = { ...captions[i], duration: Math.max(0.1, nextStart - captions[i].startTime) };
		}
	}
	return captions;
}

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

	return capOverlaps(captions);
}

/**
 * Builds caption chunks from word-level timestamps (Deepgram output).
 * Supports single-line (maxLines=1) and double-line (maxLines=2) modes.
 */
export function buildCaptionChunksFromWords({
	words,
	maxCharsPerLine = 32,
	maxLines = 1,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	words: TranscriptionWord[];
	maxCharsPerLine?: number;
	maxLines?: 1 | 2;
	minDuration?: number;
}): CaptionChunk[] {
	if (!words || words.length === 0) return [];

	// With 2 lines, distribute the total char budget across both lines
	// so each subtitle stays within maxCharsPerLine total
	const effectiveCharsPerLine = maxLines === 2
		? Math.ceil(maxCharsPerLine / 2)
		: maxCharsPerLine;

	const chunks: CaptionChunk[] = [];
	// Each entry is one line of words
	let lines: TranscriptionWord[][] = [[]];
	let currentLineChars = 0;

	const flush = () => {
		if (lines[0].length === 0) return;
		const allWords = lines.flat();
		const text = lines
			.filter((l) => l.length > 0)
			.map((lineWords) => lineWords.map((w) => w.punctuated_word || w.word).join(" "))
			.join("\n");
		const startTime = allWords[0].start;
		const endTime = allWords[allWords.length - 1].end;
		const duration = Math.max(minDuration, endTime - startTime);
		chunks.push({ text, startTime, duration });
		lines = [[]];
		currentLineChars = 0;
	};

	for (const word of words) {
		const wordText = word.punctuated_word || word.word;
		const spaceNeeded = currentLineChars === 0 ? 0 : 1;
		const totalNeeded = currentLineChars + spaceNeeded + wordText.length;

		if (currentLineChars > 0 && totalNeeded > effectiveCharsPerLine) {
			if (maxLines >= 2 && lines.length < 2) {
				// Start a second line within the same chunk
				lines.push([]);
				currentLineChars = 0;
			} else {
				flush();
			}
		}

		lines[lines.length - 1].push(word);
		currentLineChars += (currentLineChars === 0 ? 0 : 1) + wordText.length;
	}

	flush();
	return capOverlaps(chunks);
}
