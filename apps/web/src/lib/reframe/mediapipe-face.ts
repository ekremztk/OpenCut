import {
	FaceLandmarker,
	FilesetResolver,
	type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface DetectedFace {
	centerX: number; // 0..1 normalized, left to right
	centerY: number; // 0..1 normalized, top to bottom
	mouthOpenRatio: number; // 0..1, higher = more open
	confidence: number;
}

let faceLandmarker: FaceLandmarker | null = null;
let loadingPromise: Promise<FaceLandmarker> | null = null;

export async function loadFaceLandmarker(
	onProgress?: (msg: string) => void,
): Promise<FaceLandmarker> {
	if (faceLandmarker) return faceLandmarker;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		onProgress?.("Loading face detection model...");
		const vision = await FilesetResolver.forVisionTasks(
			"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/wasm",
		);
		onProgress?.("Initializing face detector...");
		const landmarker = await FaceLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath:
					"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
				delegate: "CPU",
			},
			runningMode: "VIDEO",
			numFaces: 2,
			minFaceDetectionConfidence: 0.5,
			minTrackingConfidence: 0.5,
		});
		faceLandmarker = landmarker;
		return landmarker;
	})();

	return loadingPromise;
}

// Landmark indices (MediaPipe FaceLandmarker 478-point model)
const LEFT_EYE_IDX = 33;
const RIGHT_EYE_IDX = 263;
const UPPER_LIP_IDX = 13;
const LOWER_LIP_IDX = 14;
const NOSE_TIP_IDX = 1;
const CHIN_IDX = 152;

export function extractFaces(result: FaceLandmarkerResult): DetectedFace[] {
	const faces: DetectedFace[] = [];

	for (const landmarks of result.faceLandmarks) {
		const leftEye = landmarks[LEFT_EYE_IDX];
		const rightEye = landmarks[RIGHT_EYE_IDX];
		const upperLip = landmarks[UPPER_LIP_IDX];
		const lowerLip = landmarks[LOWER_LIP_IDX];
		const noseTip = landmarks[NOSE_TIP_IDX];
		const chin = landmarks[CHIN_IDX];

		if (!leftEye || !rightEye || !upperLip || !lowerLip) continue;

		// Face horizontal center: midpoint of eyes (works even when face is turned)
		const centerX = (leftEye.x + rightEye.x) / 2;
		const centerY = (leftEye.y + rightEye.y) / 2;

		// Mouth open ratio relative to face height (nose tip to chin)
		const faceHeight = Math.abs((chin?.y ?? lowerLip.y + 0.05) - (noseTip?.y ?? upperLip.y - 0.05));
		const mouthOpen = Math.abs(lowerLip.y - upperLip.y);
		const mouthOpenRatio = faceHeight > 0 ? mouthOpen / faceHeight : 0;

		faces.push({
			centerX,
			centerY,
			mouthOpenRatio,
			confidence: 1.0, // MediaPipe doesn't expose per-face confidence
		});
	}

	return faces;
}

export async function detectFacesInFrame(
	landmarker: FaceLandmarker,
	videoElement: HTMLVideoElement,
	timestampMs: number,
): Promise<DetectedFace[]> {
	const result = landmarker.detectForVideo(videoElement, timestampMs);
	return extractFaces(result);
}
