"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useEditor } from "@/hooks/use-editor";
import { useYouTubeStore } from "@/stores/youtube-store";
import { processMediaAssets } from "@/lib/media/processing";

/**
 * Reads ?clipUrl, ?clipTitle, ?clipDesc URL params.
 * On first load: imports the video as a media asset and pre-fills YouTube metadata.
 * Must be called inside EditorProvider (project must be loaded).
 */
export function useClipImport(projectId: string) {
	const searchParams = useSearchParams();
	const editor = useEditor();
	const { loadForProject } = useYouTubeStore();
	const hasRun = useRef(false);

	const clipUrl = searchParams.get("clipUrl");
	const clipTitle = searchParams.get("clipTitle");
	const clipDesc = searchParams.get("clipDesc");

	useEffect(() => {
		// Always load YouTube metadata for this project (from localStorage or URL params)
		loadForProject(projectId, {
			title: clipTitle ?? "",
			description: clipDesc ?? "",
		});

		if (!clipUrl || hasRun.current) return;
		hasRun.current = true;

		const importClip = async () => {
			try {
				const activeProject = editor.project.getActiveOrNull();
				if (!activeProject) return;

				toast.loading("Importing clip from Prognot...", { id: "clip-import" });

				const response = await fetch(clipUrl);
				if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

				const blob = await response.blob();
				const rawName = clipUrl.split("/").pop()?.split("?")[0] ?? "clip.mp4";
				const filename = decodeURIComponent(rawName);
				const file = new File([blob], filename, { type: "video/mp4" });

				const dt = new DataTransfer();
				dt.items.add(file);

				const processedAssets = await processMediaAssets({
					files: dt.files,
					onProgress: () => {},
				});

				for (const asset of processedAssets) {
					await editor.media.addMediaAsset({
						projectId: activeProject.metadata.id,
						asset,
					});
				}

				toast.success("Clip imported! Find it in the Media panel.", { id: "clip-import" });
			} catch (error) {
				console.error("[ClipImport]", error);
				toast.error("Failed to import clip", { id: "clip-import" });
			}
		};

		importClip();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
