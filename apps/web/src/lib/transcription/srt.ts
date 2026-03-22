import type { CaptionChunk } from "@/types/transcription";

function toSrtTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function captionChunksToSrt(chunks: CaptionChunk[]): string {
	return chunks
		.map((chunk, i) => {
			const start = toSrtTime(chunk.startTime);
			const end = toSrtTime(chunk.startTime + chunk.duration);
			return `${i + 1}\n${start} --> ${end}\n${chunk.text}\n`;
		})
		.join("\n");
}

export function downloadSrt(content: string, filename = "subtitles.srt"): void {
	const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
