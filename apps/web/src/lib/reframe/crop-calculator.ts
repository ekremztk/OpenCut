import type { DetectedFace } from "./mediapipe-face";

export interface FrameAnalysis {
	timeS: number;
	faces: DetectedFace[];
}

export interface CropKeyframe {
	timeS: number; // element-local time (seconds from element start)
	offsetX: number; // canvas pixels, applied to transform.position.x
}

// EMA smoothing factor: 0.12 = smooth and stable
const EMA_ALPHA = 0.12;

// Mouth open threshold to be considered "speaking"
const SPEAKING_THRESHOLD = 0.018;

// If no face for this long, start drifting to center (seconds)
const DRIFT_TO_CENTER_AFTER_S = 1.5;

// Simplification: skip keyframe if change is less than this (pixels)
const MIN_KEYFRAME_DELTA_PX = 6;

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
	// Cover scale: how much the source is scaled to fill the canvas height
	const coverScale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const scaledSourceWidth = sourceWidth * coverScale;

	// Maximum x offset from center (in canvas pixels)
	const maxOffsetX = (scaledSourceWidth - canvasWidth) / 2;

	let smoothedOffsetX = 0;
	let lastFaceX: number | null = null;
	let lastSpeakerX: number | null = null;
	let lastFaceTime = -99;
	let prevSmoothedX = 0;

	const rawKeyframes: CropKeyframe[] = [];

	for (const frame of frames) {
		const { timeS, faces } = frame;

		let targetNormalizedX: number | null = null;

		if (faces.length > 0) {
			lastFaceTime = timeS;

			// Find the speaking face (highest mouth open ratio above threshold)
			const speakingFaces = faces.filter(f => f.mouthOpenRatio > SPEAKING_THRESHOLD);
			let activeFace: DetectedFace | null = null;

			if (speakingFaces.length === 1) {
				// One person speaking — track them
				activeFace = speakingFaces[0];
			} else if (speakingFaces.length > 1) {
				// Multiple people speaking — stay on last known speaker
				if (lastSpeakerX !== null) {
					// Pick the face closest to last speaker position
					activeFace = speakingFaces.reduce((best, f) =>
						Math.abs(f.centerX - lastSpeakerX!) < Math.abs(best.centerX - lastSpeakerX!)
							? f : best
					);
				} else {
					activeFace = speakingFaces[0];
				}
			} else {
				// Nobody speaking (laughing, silence) — use last speaker if recent
				if (lastSpeakerX !== null) {
					targetNormalizedX = lastSpeakerX;
				} else {
					// Fall back to closest face to center
					activeFace = faces.reduce((best, f) =>
						Math.abs(f.centerX - 0.5) < Math.abs(best.centerX - 0.5) ? f : best
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
			const timeSinceLastFace = timeS - lastFaceTime;
			if (timeSinceLastFace > DRIFT_TO_CENTER_AFTER_S) {
				// Slowly drift to center (normalized 0.5)
				targetNormalizedX = 0.5;
			} else if (lastFaceX !== null) {
				// Hold last known position
				targetNormalizedX = lastFaceX;
			} else {
				targetNormalizedX = 0.5;
			}
		}

		if (targetNormalizedX === null) targetNormalizedX = 0.5;

		// Convert normalized face X (0..1) to canvas offset
		// face at 0.0 (leftmost) → pan left (positive offset)
		// face at 0.5 (center)   → 0 offset
		// face at 1.0 (rightmost) → pan right (negative offset)
		const targetOffsetX = -(targetNormalizedX - 0.5) * 2 * maxOffsetX;

		// Apply EMA smoothing
		// Detect sudden large jump (scene cut): > 40% of frame width change
		const jumpThreshold = sourceWidth * coverScale * 0.4;
		if (Math.abs(targetOffsetX - smoothedOffsetX) > jumpThreshold) {
			// Scene cut — snap immediately
			smoothedOffsetX = targetOffsetX;
		} else {
			smoothedOffsetX = EMA_ALPHA * targetOffsetX + (1 - EMA_ALPHA) * smoothedOffsetX;
		}

		rawKeyframes.push({ timeS, offsetX: smoothedOffsetX });
		prevSmoothedX = smoothedOffsetX;
	}

	// Simplify: remove keyframes where change is negligible
	return simplifyKeyframes(rawKeyframes, MIN_KEYFRAME_DELTA_PX);
}

function simplifyKeyframes(
	keyframes: CropKeyframe[],
	minDelta: number,
): CropKeyframe[] {
	if (keyframes.length === 0) return [];

	const simplified: CropKeyframe[] = [keyframes[0]];
	let lastKept = keyframes[0];

	for (let i = 1; i < keyframes.length - 1; i++) {
		const delta = Math.abs(keyframes[i].offsetX - lastKept.offsetX);
		if (delta >= minDelta) {
			simplified.push(keyframes[i]);
			lastKept = keyframes[i];
		}
	}

	// Always include the last frame
	if (keyframes.length > 1) {
		simplified.push(keyframes[keyframes.length - 1]);
	}

	return simplified;
}
