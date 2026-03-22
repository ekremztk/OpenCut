import type { EditorCore } from "@/core";
import type { VideoElement } from "@/types/timeline";

export interface VideoSegment {
	trackId: string;
	elementId: string;
	/** Start of this segment in element-local time (seconds) */
	localStartS: number;
	/** End of this segment in element-local time (seconds) */
	localEndS: number;
}

/**
 * Splits a video element at every scene cut time and returns a list of
 * segments, each with its own trackId/elementId and local time range.
 *
 * Keyframe times for each segment must be relative to localStartS:
 *   keyframe.timeS = original_frame.timeS - segment.localStartS
 */
export function splitAtSceneCuts(
	editor: EditorCore,
	trackId: string,
	element: VideoElement,
	sceneCutTimesS: number[],
): VideoSegment[] {
	if (sceneCutTimesS.length === 0) {
		return [
			{
				trackId,
				elementId: element.id,
				localStartS: 0,
				localEndS: element.duration,
			},
		];
	}

	const segments: VideoSegment[] = [];
	// The "current right" element that we will split next
	let currentTrackId = trackId;
	let currentElementId = element.id;
	let currentLocalStart = 0;

	for (const cutLocalS of sceneCutTimesS) {
		// Convert element-local time to absolute timeline time
		const absoluteSplitTime = element.startTime + cutLocalS;

		const rightSide = editor.timeline.splitElements({
			elements: [
				{ trackId: currentTrackId, elementId: currentElementId },
			],
			splitTime: absoluteSplitTime,
		});

		if (rightSide.length === 0) {
			// Split failed (shouldn't happen) — skip this cut
			continue;
		}

		// Left segment is the one we just closed
		segments.push({
			trackId: currentTrackId,
			elementId: currentElementId,
			localStartS: currentLocalStart,
			localEndS: cutLocalS,
		});

		// Move pointer to the right segment for the next iteration
		currentTrackId = rightSide[0].trackId;
		currentElementId = rightSide[0].elementId;
		currentLocalStart = cutLocalS;
	}

	// Push the final (rightmost) segment
	segments.push({
		trackId: currentTrackId,
		elementId: currentElementId,
		localStartS: currentLocalStart,
		localEndS: element.duration,
	});

	return segments;
}
