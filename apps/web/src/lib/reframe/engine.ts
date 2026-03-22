import { loadFaceLandmarker, detectFacesInFrame } from "./mediapipe-face";
import { SceneDetector, filterCuts } from "./scene-detector";
import { calculateCropKeyframes, type FrameAnalysis } from "./crop-calculator";
import { splitAtSceneCuts } from "./timeline-splitter";
import type { EditorCore } from "@/core";
import type { VideoElement, VideoTrack } from "@/types/timeline";

const SAMPLE_FPS = 8;

export interface ReframeProgress {
	step: string;
	percent: number;
}

export interface ReframeResult {
	trackId: string;
	elementId: string;
	sceneCount: number;
	keyframeCount: number;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function runReframe(
	editor: EditorCore,
	onProgress: (p: ReframeProgress) => void,
): Promise<ReframeResult[]> {
	// 1. Find all video elements
	const videoElements = collectVideoElements(editor);
	if (videoElements.length === 0) throw new Error("No video elements on timeline");

	// 2. Switch canvas to 9:16
	onProgress({ step: "Switching to 9:16...", percent: 2 });
	await editor.project.updateSettings({
		settings: { canvasSize: { width: 1080, height: 1920 } },
	});

	// 3. Load MediaPipe
	onProgress({ step: "Loading face detection model...", percent: 5 });
	const landmarker = await loadFaceLandmarker((msg) =>
		onProgress({ step: msg, percent: 8 }),
	);

	const results: ReframeResult[] = [];
	const total = videoElements.length;

	for (let ei = 0; ei < total; ei++) {
		const { trackId, element } = videoElements[ei];
		const basePercent = 10 + (ei / total) * 85;

		const label =
			total > 1 ? ` (clip ${ei + 1}/${total})` : "";

		// 4. Sample frames: face detection + scene detection simultaneously
		onProgress({
			step: `Analyzing frames${label}...`,
			percent: Math.round(basePercent),
		});

		const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
		if (!asset?.url) continue;

		const { frames, sceneCutTimesS } = await sampleVideoFrames({
			url: asset.url,
			elementDuration: element.duration,
			trimStart: element.trimStart,
			landmarker,
			onProgress: (p) =>
				onProgress({
					step: `Analyzing frames${label}... ${p}%`,
					percent: Math.round(basePercent + (p / 100) * 45),
				}),
		});

		onProgress({
			step: `Found ${sceneCutTimesS.length} scene cut(s)${label}. Splitting...`,
			percent: Math.round(basePercent + 48),
		});

		// 5. Split element at scene cuts → independent segments
		const segments = splitAtSceneCuts(
			editor,
			trackId,
			element,
			sceneCutTimesS,
		);

		onProgress({
			step: `Applying face tracking${label}...`,
			percent: Math.round(basePercent + 55),
		});

		const sourceWidth = asset.width ?? 1920;
		const sourceHeight = asset.height ?? 1080;
		let totalKeyframes = 0;

		// 6. Process each segment independently
		for (const segment of segments) {
			// Filter frames that belong to this segment and re-zero their time
			const segmentFrames: FrameAnalysis[] = frames
				.filter(
					(f) =>
						f.timeS >= segment.localStartS &&
						f.timeS < segment.localEndS,
				)
				.map((f) => ({
					timeS: f.timeS - segment.localStartS,
					faces: f.faces,
				}));

			// Calculate crop keyframes with fresh EMA for this segment
			const cropKeyframes = calculateCropKeyframes({
				frames: segmentFrames,
				sourceWidth,
				sourceHeight,
				canvasWidth: 1080,
				canvasHeight: 1920,
			});

			// Enable cover mode
			editor.timeline.updateElements({
				updates: [
					{
						trackId: segment.trackId,
						elementId: segment.elementId,
						updates: { coverMode: true } as Partial<VideoElement>,
					},
				],
				pushHistory: false,
			});

			// Write position.x keyframes
			if (cropKeyframes.length > 0) {
				editor.timeline.upsertKeyframes({
					keyframes: cropKeyframes.map((kf) => ({
						trackId: segment.trackId,
						elementId: segment.elementId,
						propertyPath: "transform.position.x" as const,
						time: kf.timeS,
						value: kf.offsetX,
						interpolation: "linear" as const,
					})),
				});
				totalKeyframes += cropKeyframes.length;
			}
		}

		results.push({
			trackId,
			elementId: element.id,
			sceneCount: segments.length,
			keyframeCount: totalKeyframes,
		});
	}

	onProgress({ step: "Done!", percent: 100 });
	return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectVideoElements(
	editor: EditorCore,
): Array<{ trackId: string; element: VideoElement }> {
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

interface RawFrame extends FrameAnalysis {
	// timeS here is element-local (from trimStart), NOT adjusted per-segment
}

async function sampleVideoFrames({
	url,
	elementDuration,
	trimStart,
	landmarker,
	onProgress,
}: {
	url: string;
	elementDuration: number;
	trimStart: number;
	landmarker: Awaited<ReturnType<typeof loadFaceLandmarker>>;
	onProgress: (percent: number) => void;
}): Promise<{ frames: RawFrame[]; sceneCutTimesS: number[] }> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.crossOrigin = "anonymous";

		video.addEventListener("error", () =>
			reject(new Error("Failed to load video for analysis")),
		);

		video.addEventListener("loadedmetadata", async () => {
			const interval = 1 / SAMPLE_FPS;
			const totalFrames = Math.ceil(elementDuration * SAMPLE_FPS);
			const frames: RawFrame[] = [];
			const rawSceneCuts: number[] = [];
			const sceneDetector = new SceneDetector();

			for (let i = 0; i < totalFrames; i++) {
				const elementLocalTimeS = i * interval;
				const videoTimeS = trimStart + elementLocalTimeS;

				video.currentTime = videoTimeS;
				await waitForSeek(video);

				// Scene detection first (before MediaPipe — uses same video frame)
				const isSceneCut = i > 0 && sceneDetector.check(video);
				if (isSceneCut) {
					rawSceneCuts.push(elementLocalTimeS);
				} else if (i === 0) {
					sceneDetector.check(video); // initialize detector
				}

				// Face detection
				const timestampMs = video.currentTime * 1000;
				const faces = await detectFacesInFrame(landmarker, video, timestampMs);

				frames.push({ timeS: elementLocalTimeS, faces });

				if (i % 8 === 0) {
					onProgress(Math.round((i / totalFrames) * 100));
				}
			}

			video.src = "";

			const sceneCutTimesS = filterCuts(rawSceneCuts, elementDuration);
			resolve({ frames, sceneCutTimesS });
		});

		video.load();
	});
}

function waitForSeek(video: HTMLVideoElement): Promise<void> {
	return new Promise((resolve) => {
		if (!video.seeking) {
			resolve();
			return;
		}
		const onSeeked = () => {
			video.removeEventListener("seeked", onSeeked);
			resolve();
		};
		video.addEventListener("seeked", onSeeked);
	});
}
