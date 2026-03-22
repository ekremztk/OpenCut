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
 * Two-pass initial speaker detection for a segment.
 *
 * Pass 1: Find the first frame where exactly one face is clearly speaking.
 * Pass 2: Fallback — pick the largest face (bboxWidth) as dominant speaker.
 *
 * Returns normalized X (0..1) or null if no face found at all.
 */
function findInitialSpeaker(frames: FrameAnalysis[]): number | null {
	// Pass 1: first unambiguous speaker
	for (const { faces } of frames) {
		const speakers = faces.filter((f) => f.mouthOpenRatio > SPEAKING_THRESHOLD);
		if (speakers.length === 1) {
			return speakers[0].centerX;
		}
	}

	// Pass 2: dominant face (closest to camera = largest bboxWidth)
	let bestFace: DetectedFace | null = null;
	for (const { faces } of frames) {
		for (const f of faces) {
			if (!bestFace || f.bboxWidth > bestFace.bboxWidth) {
				bestFace = f;
			}
		}
	}
	return bestFace ? bestFace.centerX : null;
}

/**
 * Calculates crop keyframes for a single segment (scene-cut boundary or full clip).
 * Each call starts with a fresh EMA — never bleeds across scene cuts.
 *
 * Correct pan formula:
 *   offsetX = scaledSourceWidth * (0.5 - normalizedFaceX)
 *   clamped to [-maxOffsetX, maxOffsetX]
 *
 * Positive offsetX → element shifted right → reveals left side of frame (face on left).
 * Negative offsetX → element shifted left  → reveals right side of frame (face on right).
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

	// Pre-scan: find who is speaking at the start of this segment
	// so we never accidentally center between two faces on the first frame
	const initialSpeakerX = findInitialSpeaker(frames);

	// State — fresh for every segment
	const initOffsetX =
		initialSpeakerX !== null
			? Math.max(-maxOffsetX, Math.min(maxOffsetX, scaledSourceWidth * (0.5 - initialSpeakerX)))
			: 0;

	let smoothedOffsetX = initOffsetX;
	let lastSpeakerX: number | null = initialSpeakerX;
	let lastFaceX: number | null = initialSpeakerX;
	let lastFaceTimeS = initialSpeakerX !== null ? 0 : -99;

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
					// No speaker history — track dominant face (largest = closest)
					activeFace = faces.reduce((best, f) =>
						f.bboxWidth > best.bboxWidth ? f : best,
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
				targetNormalizedX = lastFaceX; // hold last known position
			}
		}

		// CORRECT formula:
		//   face at 0.5 (center)  → offsetX = 0 (no pan)
		//   face at 0.0 (far left) → offsetX = +maxOffsetX (pan right to reveal left)
		//   face at 1.0 (far right)→ offsetX = -maxOffsetX (pan left to reveal right)
		const targetOffsetX = Math.max(
			-maxOffsetX,
			Math.min(maxOffsetX, scaledSourceWidth * (0.5 - targetNormalizedX)),
		);

		// EMA smoothing (first frame already initialized to initOffsetX)
		smoothedOffsetX =
			EMA_ALPHA * targetOffsetX + (1 - EMA_ALPHA) * smoothedOffsetX;

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
