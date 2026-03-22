import { loadFaceLandmarker, detectFacesInFrame } from "./mediapipe-face";
import { calculateCropKeyframes, type FrameAnalysis } from "./crop-calculator";
import type { EditorCore } from "@/core";
import type { VideoElement, VideoTrack } from "@/types/timeline";

// Frames per second to sample from video (8fps on 60s = 480 frames)
const SAMPLE_FPS = 8;

export interface ReframeProgress {
	step: string;
	percent: number;
}

export interface ReframeResult {
	trackId: string;
	elementId: string;
	keyframeCount: number;
}

export async function runReframe(
	editor: EditorCore,
	onProgress: (p: ReframeProgress) => void,
): Promise<ReframeResult[]> {
	const project = editor.project.getActiveOrNull();
	if (!project) throw new Error("No active project");

	// Find all video elements on the timeline
	const tracks = editor.timeline.getTracks();
	const videoElements: Array<{ trackId: string; element: VideoElement }> = [];

	for (const track of tracks) {
		if (track.type === "video") {
			for (const el of (track as VideoTrack).elements) {
				if (el.type === "video") {
					videoElements.push({ trackId: track.id, element: el as VideoElement });
				}
			}
		}
	}

	if (videoElements.length === 0) {
		throw new Error("No video elements found on timeline");
	}

	// Step 1: Change canvas to 9:16
	onProgress({ step: "Switching to 9:16 format...", percent: 2 });
	await editor.project.updateSettings({
		settings: { canvasSize: { width: 1080, height: 1920 } },
	});

	// Step 2: Load MediaPipe
	onProgress({ step: "Loading face detection model...", percent: 5 });
	const landmarker = await loadFaceLandmarker((msg) =>
		onProgress({ step: msg, percent: 8 }),
	);

	const results: ReframeResult[] = [];
	const totalElements = videoElements.length;

	for (let ei = 0; ei < totalElements; ei++) {
		const { trackId, element } = videoElements[ei];
		const basePercent = 10 + (ei / totalElements) * 75;

		onProgress({
			step: `Analyzing faces${totalElements > 1 ? ` (clip ${ei + 1}/${totalElements})` : ""}...`,
			percent: Math.round(basePercent),
		});

		// Get media asset for this element
		const assets = editor.media.getAssets();
		const asset = assets.find((a) => a.id === element.mediaId);
		if (!asset?.url) continue;

		// Step 3: Sample frames and detect faces
		const frames = await sampleVideoFrames({
			url: asset.url,
			elementDuration: element.duration,
			trimStart: element.trimStart,
			landmarker,
			onProgress: (p) =>
				onProgress({
					step: `Detecting faces... (${p}%)`,
					percent: Math.round(basePercent + (p / 100) * 40),
				}),
		});

		// Step 4: Calculate crop keyframes
		onProgress({ step: "Calculating crop positions...", percent: Math.round(basePercent + 50) });
		const canvasSize = project.settings.canvasSize;
		const sourceWidth = asset.width ?? 1920;
		const sourceHeight = asset.height ?? 1080;

		const cropKeyframes = calculateCropKeyframes({
			frames,
			sourceWidth,
			sourceHeight,
			canvasWidth: 1080,
			canvasHeight: 1920,
		});

		// Step 5: Apply coverMode + keyframes to element
		onProgress({ step: "Applying reframe to timeline...", percent: Math.round(basePercent + 60) });

		// Enable cover mode on the element
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { coverMode: true } as Partial<VideoElement>,
				},
			],
		});

		// Write position.x keyframes (times are element-local)
		if (cropKeyframes.length > 0) {
			editor.timeline.upsertKeyframes({
				keyframes: cropKeyframes.map((kf) => ({
					trackId,
					elementId: element.id,
					propertyPath: "transform.position.x" as const,
					time: kf.timeS,
					value: kf.offsetX,
					interpolation: "linear" as const,
				})),
			});
		}

		results.push({
			trackId,
			elementId: element.id,
			keyframeCount: cropKeyframes.length,
		});
	}

	onProgress({ step: "Done!", percent: 100 });
	return results;
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
}): Promise<FrameAnalysis[]> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.crossOrigin = "anonymous";

		video.addEventListener("error", () => reject(new Error("Failed to load video")));

		video.addEventListener("loadedmetadata", async () => {
			const interval = 1 / SAMPLE_FPS;
			const frames: FrameAnalysis[] = [];
			const totalFrames = Math.ceil(elementDuration * SAMPLE_FPS);

			for (let i = 0; i < totalFrames; i++) {
				const timeS = trimStart + i * interval;
				video.currentTime = timeS;

				await new Promise<void>((res) => {
					const onSeeked = () => {
						video.removeEventListener("seeked", onSeeked);
						res();
					};
					video.addEventListener("seeked", onSeeked);
				});

				const timestampMs = video.currentTime * 1000;
				const faces = await detectFacesInFrame(landmarker, video, timestampMs);

				frames.push({
					timeS: i * interval, // element-local time
					faces,
				});

				if (i % 10 === 0) {
					onProgress(Math.round((i / totalFrames) * 100));
				}
			}

			video.src = "";
			resolve(frames);
		});

		video.load();
	});
}
