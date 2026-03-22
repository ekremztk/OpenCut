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

// EMA smoothing — 0.12 keeps camera smooth on speaker changes
const EMA_ALPHA = 0.12;

// Mouth open ratio to qualify as "speaking"
const SPEAKING_THRESHOLD = 0.018;

// Minimum change (px) to emit a keyframe
const MIN_KEYFRAME_DELTA_PX = 5;

/**
 * Pre-scan: find who is most likely speaking at the start of this segment.
 * Used to seed the EMA so the camera doesn't start at center on frame 1.
 *
 * Pass 1: first frame with exactly one clear speaker.
 * Pass 2: largest face (closest to camera) as fallback.
 */
function findInitialSpeaker(frames: FrameAnalysis[]): number | null {
	for (const { faces } of frames) {
		const speakers = faces.filter((f) => f.mouthOpenRatio > SPEAKING_THRESHOLD);
		if (speakers.length === 1) return speakers[0].centerX;
	}
	let bestFace: DetectedFace | null = null;
	for (const { faces } of frames) {
		for (const f of faces) {
			if (!bestFace || f.bboxWidth > bestFace.bboxWidth) bestFace = f;
		}
	}
	return bestFace ? bestFace.centerX : null;
}

/**
 * Calculates crop keyframes for a single segment.
 *
 * Rule: whoever is speaking → camera follows.
 *       Nobody speaking / no face → hold last speaker position.
 *       Never average, never drift to center.
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

	// Seed EMA from pre-scanned initial speaker
	const initialSpeakerX = findInitialSpeaker(frames);
	const initOffsetX =
		initialSpeakerX !== null
			? Math.max(-maxOffsetX, Math.min(maxOffsetX, scaledSourceWidth * (0.5 - initialSpeakerX)))
			: 0;

	let smoothedOffsetX = initOffsetX;
	// lastSpeakerX: the last position we actively tracked a speaker
	let lastSpeakerX: number = initialSpeakerX ?? 0.5;

	const rawKeyframes: CropKeyframe[] = [];

	for (const { timeS, faces } of frames) {
		// Determine the active speaker this frame, if any
		let newSpeakerX: number | null = null;

		if (faces.length > 0) {
			const speakingFaces = faces.filter(
				(f) => f.mouthOpenRatio > SPEAKING_THRESHOLD,
			);

			if (speakingFaces.length === 1) {
				// One clear speaker — follow them
				newSpeakerX = speakingFaces[0].centerX;
			} else if (speakingFaces.length > 1) {
				// Multiple speakers — stay on whoever we were tracking
				const closest = speakingFaces.reduce((best, f) =>
					Math.abs(f.centerX - lastSpeakerX) <
					Math.abs(best.centerX - lastSpeakerX)
						? f
						: best,
				);
				newSpeakerX = closest.centerX;
			}
			// Nobody speaking → newSpeakerX stays null → hold
		}
		// No face detected → newSpeakerX stays null → hold

		if (newSpeakerX !== null) {
			lastSpeakerX = newSpeakerX;
		}

		// Always target lastSpeakerX — hold when no speaker detected
		const targetOffsetX = Math.max(
			-maxOffsetX,
			Math.min(maxOffsetX, scaledSourceWidth * (0.5 - lastSpeakerX)),
		);

		smoothedOffsetX = EMA_ALPHA * targetOffsetX + (1 - EMA_ALPHA) * smoothedOffsetX;

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
