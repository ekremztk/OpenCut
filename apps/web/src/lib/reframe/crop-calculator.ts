import type { DetectedFace } from "./mediapipe-face";

export interface FrameAnalysis {
	/** Element-local time in seconds (0 = start of this specific segment). */
	timeS: number;
	faces: DetectedFace[];
}

export interface CropKeyframe {
	/** Element-local time in seconds. */
	timeS: number;
	/** Canvas-pixel offset for transform.position.x */
	offsetX: number;
}

// EMA smoothing — 0.12 = smooth tracking, stable on slow pans
const EMA_ALPHA = 0.12;

// Mouth open ratio to qualify as "speaking"
const SPEAKING_THRESHOLD = 0.018;

// Seconds of no face before slowly drifting to center
const DRIFT_TO_CENTER_AFTER_S = 1.5;

// Minimum change (px) to emit a keyframe — keeps keyframe count low
const MIN_KEYFRAME_DELTA_PX = 5;

/**
 * Calculates crop keyframes for a single segment (scene-cut boundary or full clip).
 * Each call starts with a fresh EMA — never bleeds across scene cuts.
 */
export function calculateCropKeyframes({
	frames,
	sourceWidth,
	sourceHeight,
	canvasWidth,
	canvasHeight,
}: {
	frames: FrameAnalysis[];
	sourceWidth: number;
	sourceHeight: number;
	canvasWidth: number;
	canvasHeight: number;
}): CropKeyframe[] {
	if (frames.length === 0) return [];

	const coverScale = Math.max(
		canvasWidth / sourceWidth,
		canvasHeight / sourceHeight,
	);
	const scaledSourceWidth = sourceWidth * coverScale;
	const maxOffsetX = (scaledSourceWidth - canvasWidth) / 2;

	// State — fresh for every segment
	let smoothedOffsetX = 0;
	let initialized = false;
	let lastSpeakerX: number | null = null;
	let lastFaceX: number | null = null;
	let lastFaceTimeS = -99;

	const rawKeyframes: CropKeyframe[] = [];

	for (const { timeS, faces } of frames) {
		let targetNormalizedX = 0.5; // default: center

		if (faces.length > 0) {
			lastFaceTimeS = timeS;

			const speakingFaces = faces.filter(
				(f) => f.mouthOpenRatio > SPEAKING_THRESHOLD,
			);

			let activeFace: DetectedFace | null = null;

			if (speakingFaces.length === 1) {
				// Clear single speaker
				activeFace = speakingFaces[0];
			} else if (speakingFaces.length > 1) {
				// Multiple speaking — stay on whoever was speaking last
				if (lastSpeakerX !== null) {
					activeFace = speakingFaces.reduce((best, f) =>
						Math.abs(f.centerX - lastSpeakerX!) <
						Math.abs(best.centerX - lastSpeakerX!)
							? f
							: best,
					);
				} else {
					// No prior speaker — pick the one with more open mouth
					activeFace = speakingFaces.reduce((best, f) =>
						f.mouthOpenRatio > best.mouthOpenRatio ? f : best,
					);
				}
			} else {
				// Nobody clearly speaking: hold last speaker, don't drift yet
				if (lastSpeakerX !== null) {
					targetNormalizedX = lastSpeakerX;
				} else {
					// No speaker history — track face closest to center
					activeFace = faces.reduce((best, f) =>
						Math.abs(f.centerX - 0.5) < Math.abs(best.centerX - 0.5)
							? f
							: best,
					);
				}
			}

			if (activeFace) {
				targetNormalizedX = activeFace.centerX;
				lastSpeakerX = activeFace.centerX;
				lastFaceX = activeFace.centerX;
			}
		} else {
			// No face detected
			const gap = timeS - lastFaceTimeS;
			if (gap > DRIFT_TO_CENTER_AFTER_S) {
				targetNormalizedX = 0.5; // drift to center
			} else if (lastFaceX !== null) {
				targetNormalizedX = lastFaceX; // hold
			}
		}

		// Map normalized face X to canvas offsetX:
		// face at 0.5 (center) → offsetX 0
		// face at 0.0 (far left) → pan right → positive offsetX
		// face at 1.0 (far right) → pan left → negative offsetX
		const targetOffsetX = -(targetNormalizedX - 0.5) * 2 * maxOffsetX;

		// First frame of segment: snap immediately (no lerp)
		if (!initialized) {
			smoothedOffsetX = targetOffsetX;
			initialized = true;
		} else {
			smoothedOffsetX =
				EMA_ALPHA * targetOffsetX + (1 - EMA_ALPHA) * smoothedOffsetX;
		}

		rawKeyframes.push({ timeS, offsetX: smoothedOffsetX });
	}

	return simplifyKeyframes(rawKeyframes, MIN_KEYFRAME_DELTA_PX);
}

function simplifyKeyframes(
	keyframes: CropKeyframe[],
	minDelta: number,
): CropKeyframe[] {
	if (keyframes.length === 0) return [];

	const out: CropKeyframe[] = [keyframes[0]];
	let lastKept = keyframes[0];

	for (let i = 1; i < keyframes.length - 1; i++) {
		if (Math.abs(keyframes[i].offsetX - lastKept.offsetX) >= minDelta) {
			out.push(keyframes[i]);
			lastKept = keyframes[i];
		}
	}

	if (keyframes.length > 1) {
		out.push(keyframes[keyframes.length - 1]);
	}

	return out;
}
