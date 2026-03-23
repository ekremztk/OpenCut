/**
 * Backend-powered reframe engine.
 *
 * Replaces the old browser-side MediaPipe engine with a Railway backend call.
 * The backend uses scene detection + face detection + Deepgram diarization
 * to produce a proper 9:16 video file uploaded to R2.
 *
 * Flow:
 *   1. Collect video elements from the timeline
 *   2. POST /reframe/process → get reframe_job_id
 *   3. Poll GET /reframe/status/{id} every 2s
 *   4. When done: download result video, add as new media asset
 */

import type { EditorCore } from "@/core";
import type { VideoTrack, VideoElement } from "@/types/timeline";
import { processMediaAssets } from "@/lib/media/processing";

const PROGNOT_API = process.env.NEXT_PUBLIC_PROGNOT_API_URL ?? "";
const POLL_INTERVAL_MS = 2000;

export interface ReframeProgress {
	step: string;
	percent: number;
}

export interface ReframeResult {
	outputUrl: string;
	assetId: string;
}

export async function runReframe(
	editor: EditorCore,
	onProgress: (p: ReframeProgress) => void,
): Promise<ReframeResult[]> {
	const videoElements = collectVideoElements(editor);
	if (videoElements.length === 0) {
		throw new Error("No video elements on timeline");
	}

	if (!PROGNOT_API) {
		throw new Error("NEXT_PUBLIC_PROGNOT_API_URL is not configured");
	}

	const activeProject = editor.project.getActive();
	const results: ReframeResult[] = [];

	for (let i = 0; i < videoElements.length; i++) {
		const { element } = videoElements[i];
		const label = videoElements.length > 1 ? ` (clip ${i + 1}/${videoElements.length})` : "";

		const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
		if (!asset?.url) {
			console.warn(`[Reframe] No URL for element ${element.id}, skipping`);
			continue;
		}

		onProgress({ step: `Starting reframe${label}...`, percent: 2 });

		// Start reframe job on backend
		const startRes = await fetch(`${PROGNOT_API}/reframe/process`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				clip_url: asset.url,
				clip_start: element.trimStart ?? 0,
				clip_end: element.trimStart != null ? element.trimStart + element.duration : null,
			}),
		});

		if (!startRes.ok) {
			throw new Error(`Reframe start failed: ${startRes.status}`);
		}

		const { reframe_job_id } = await startRes.json();

		// Poll for progress
		const outputUrl = await pollReframeJob(reframe_job_id, (step, percent) => {
			onProgress({ step: step + label, percent });
		});

		onProgress({ step: `Adding to media panel${label}...`, percent: 97 });

		// Download result and add as media asset
		const assetId = await addReframeAssetToProject(editor, activeProject.metadata.id, outputUrl);

		results.push({ outputUrl, assetId });
	}

	onProgress({ step: "Done! Find your 9:16 video in the Media panel.", percent: 100 });
	return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectVideoElements(editor: EditorCore): Array<{ trackId: string; element: VideoElement }> {
	const result: Array<{ trackId: string; element: VideoElement }> = [];
	for (const track of editor.timeline.getTracks()) {
		if (track.type !== "video") continue;
		for (const el of (track as VideoTrack).elements) {
			if (el.type === "video") {
				result.push({ trackId: track.id, element: el as VideoElement });
			}
		}
	}
	return result;
}

async function pollReframeJob(
	reframeJobId: string,
	onProgress: (step: string, percent: number) => void,
): Promise<string> {
	const maxAttempts = 300; // ~10 minutes

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		await sleep(POLL_INTERVAL_MS);

		const res = await fetch(`${PROGNOT_API}/reframe/status/${reframeJobId}`);
		if (!res.ok) {
			throw new Error(`Status check failed: ${res.status}`);
		}

		const data = await res.json();
		onProgress(data.step ?? "Processing...", data.percent ?? 0);

		if (data.status === "done") {
			if (!data.output_url) throw new Error("Reframe succeeded but no output URL");
			return data.output_url as string;
		}

		if (data.status === "error") {
			throw new Error(`Reframe failed: ${data.error ?? "Unknown error"}`);
		}
	}

	throw new Error("Reframe timed out after 10 minutes");
}

async function addReframeAssetToProject(
	editor: EditorCore,
	projectId: string,
	outputUrl: string,
): Promise<string> {
	// Fetch the output video and convert to File for processing
	const response = await fetch(outputUrl);
	if (!response.ok) throw new Error(`Failed to fetch reframe output: ${response.status}`);

	const blob = await response.blob();
	const filename = `reframe_${Date.now()}.mp4`;
	const file = new File([blob], filename, { type: "video/mp4" });

	const dt = new DataTransfer();
	dt.items.add(file);

	const processedAssets = await processMediaAssets({ files: dt.files });
	if (processedAssets.length === 0) throw new Error("Failed to process reframe output");

	const asset = processedAssets[0];
	await editor.media.addMediaAsset({ projectId, asset });

	// Return the ID of the newly added asset
	const allAssets = editor.media.getAssets();
	const newAsset = allAssets.find((a) => a.name === filename);
	return newAsset?.id ?? "";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
