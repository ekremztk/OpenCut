/**
 * Backend-powered reframe engine — keyframe mode.
 *
 * Instead of rendering a new video, the backend returns per-frame crop
 * positions converted to canvas keyframes. These are applied directly to
 * the timeline element so the user can manually adjust any frame.
 *
 * Flow:
 *   1. Collect video elements from the timeline
 *   2. POST /reframe/process → get reframe_job_id
 *   3. Poll GET /reframe/status/{id} every 2s
 *   4. When done: apply keyframes to element + set canvas to 9:16
 */

import type { EditorCore } from "@/core";
import type { VideoTrack, VideoElement } from "@/types/timeline";
import type { AnimationPropertyPath } from "@/types/animation";

const PROGNOT_API = process.env.NEXT_PUBLIC_PROGNOT_API_URL ?? "";
const POLL_INTERVAL_MS = 2000;

export interface ReframeProgress {
	step: string;
	percent: number;
}

export interface ReframeResult {
	elementId: string;
	keyframeCount: number;
}

interface BackendKeyframe {
	time_s: number;
	offset_x: number;
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

	const results: ReframeResult[] = [];

	for (let i = 0; i < videoElements.length; i++) {
		const { trackId, element } = videoElements[i];
		const label = videoElements.length > 1 ? ` (clip ${i + 1}/${videoElements.length})` : "";

		const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
		if (!asset?.file && !asset?.url) {
			console.warn(`[Reframe] No file/URL for element ${element.id}, skipping`);
			continue;
		}

		onProgress({ step: `Starting reframe${label}...`, percent: 2 });

		// Resolve a backend-accessible URL.
		// blob: URLs only exist in the browser — upload the file first.
		let clipUrl: string | null = null;
		let clipLocalPath: string | null = null;

		if (asset.url && !asset.url.startsWith("blob:")) {
			clipUrl = asset.url;
		} else if (asset.file) {
			onProgress({ step: `Uploading video${label}...`, percent: 5 });
			clipLocalPath = await uploadFileToBackend(asset.file);
		} else {
			throw new Error("No accessible video source for reframe");
		}

		// Start reframe job on backend
		const startRes = await fetch(`${PROGNOT_API}/reframe/process`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				clip_url: clipUrl,
				clip_local_path: clipLocalPath,
				clip_start: element.trimStart ?? 0,
				clip_end: element.trimStart != null ? element.trimStart + element.duration : null,
			}),
		});

		if (!startRes.ok) {
			throw new Error(`Reframe start failed: ${startRes.status}`);
		}

		const { reframe_job_id } = await startRes.json();

		// Poll for completion
		const { keyframes, src_w, src_h } = await pollReframeJob(reframe_job_id, (step, percent) => {
			onProgress({ step: step + label, percent });
		});

		onProgress({ step: `Applying keyframes${label}...`, percent: 97 });

		// Apply to timeline
		const keyframeCount = applyReframeToElement(editor, trackId, element, keyframes, src_w, src_h);

		results.push({ elementId: element.id, keyframeCount });
	}

	// Set canvas to 9:16
	await editor.project.updateSettings({
		settings: { canvasSize: { width: 1080, height: 1920 } },
	});

	onProgress({ step: "Done! Keyframes applied to timeline.", percent: 100 });
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
): Promise<{ keyframes: BackendKeyframe[]; src_w: number; src_h: number }> {
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
			if (!data.keyframes) throw new Error("Reframe succeeded but no keyframes returned");
			console.log(`[Reframe] Backend done — ${data.keyframes.length} keyframes, src=${data.src_w}x${data.src_h}`);
			return {
				keyframes: data.keyframes as BackendKeyframe[],
				src_w: data.src_w as number,
				src_h: data.src_h as number,
			};
		}

		if (data.status === "error") {
			throw new Error(`Reframe failed: ${data.error ?? "Unknown error"}`);
		}
	}

	throw new Error("Reframe timed out after 10 minutes");
}

function applyReframeToElement(
	editor: EditorCore,
	trackId: string,
	element: VideoElement,
	keyframes: BackendKeyframe[],
	_src_w: number,
	_src_h: number,
): number {
	const trimStart = element.trimStart ?? 0;

	console.log(
		`[Reframe] Element: id=${element.id} duration=${element.duration} trimStart=${trimStart} trimEnd=${element.trimEnd}`,
	);
	console.log(`[Reframe] Backend keyframes received: ${keyframes.length}`, keyframes.slice(0, 5));

	// Enable cover mode so the video fills the 9:16 canvas
	editor.timeline.updateElements({
		updates: [{ trackId, elementId: element.id, updates: { coverMode: true } }],
	});

	// Convert backend keyframes (absolute video time) to element-local time.
	// Clamp negative times to 0 (pre-trim frames) rather than filtering them out.
	// upsertKeyframes already bounds time to [0, element.duration] internally.
	const kfBatch = keyframes.map((kf) => ({
		trackId,
		elementId: element.id,
		propertyPath: "transform.position.x" as AnimationPropertyPath,
		time: Math.max(0, kf.time_s - trimStart),
		value: kf.offset_x,
		interpolation: "linear" as const,
	}));

	console.log(`[Reframe] Applying ${kfBatch.length} keyframes to element ${element.id}`);

	if (kfBatch.length > 0) {
		editor.timeline.upsertKeyframes({ keyframes: kfBatch });
	}

	return kfBatch.length;
}

async function uploadFileToBackend(file: File): Promise<string> {
	const formData = new FormData();
	formData.append("file", file);

	const res = await fetch(`${PROGNOT_API}/reframe/upload`, {
		method: "POST",
		body: formData,
	});

	if (!res.ok) {
		throw new Error(`Video upload failed: ${res.status}`);
	}

	const { local_path } = await res.json();
	return local_path as string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
