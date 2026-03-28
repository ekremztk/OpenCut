/**
 * API-backed storage service.
 * Replaces IndexedDB/OPFS with Supabase (project data) + R2 (media files).
 * Implements the same interface as StorageService so all callers work unchanged.
 */

import type { TProject, TProjectMetadata } from "@/types/project";
import { getProjectDurationFromScenes } from "@/lib/scenes";
import type { MediaAsset } from "@/types/assets";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@/types/sounds";
import type { SerializedProject } from "./types";

// ─── helpers ───────────────────────────────────────────────────────────────

function toProject(serialized: SerializedProject): TProject {
	const scenes = (serialized.scenes ?? []).map((scene) => ({
		id: scene.id,
		name: scene.name,
		isMain: scene.isMain,
		tracks: (scene.tracks ?? []).map((track) =>
			track.type === "video" ? { ...track, isMain: track.isMain ?? false } : track,
		),
		bookmarks: scene.bookmarks ?? [],
		createdAt: new Date(scene.createdAt),
		updatedAt: new Date(scene.updatedAt),
	}));

	return {
		metadata: {
			id: serialized.metadata.id,
			name: serialized.metadata.name,
			thumbnail: serialized.metadata.thumbnail,
			duration:
				serialized.metadata.duration ??
				getProjectDurationFromScenes({ scenes }),
			createdAt: new Date(serialized.metadata.createdAt),
			updatedAt: new Date(serialized.metadata.updatedAt),
		},
		scenes,
		currentSceneId: serialized.currentSceneId || "",
		settings: serialized.settings,
		version: serialized.version,
		timelineViewState: serialized.timelineViewState,
	};
}

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
	const res = await fetch(path, options);
	return res;
}

// ─── API Storage Service ────────────────────────────────────────────────────

class ApiStorageService {
	// ── Project methods ──────────────────────────────────────────────────────

	async saveProject({ project }: { project: TProject }): Promise<void> {
		const scenes = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: scene.tracks,
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serialized: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration:
					project.metadata.duration ??
					getProjectDurationFromScenes({ scenes: project.scenes }),
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
		};

		// Try PUT (update) first; if 404, POST (create)
		const putRes = await apiFetch(`/api/projects/${project.metadata.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration: serialized.metadata.duration,
				fps: project.settings.fps,
				canvas_width: project.settings.canvasSize?.width,
				canvas_height: project.settings.canvasSize?.height,
				project_data: serialized,
				project_version: project.version,
			}),
		});

		if (putRes.status === 404) {
			// Project doesn't exist yet — create it
			await apiFetch("/api/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: project.metadata.name,
					fps: project.settings.fps,
					canvas_width: project.settings.canvasSize?.width,
					canvas_height: project.settings.canvasSize?.height,
					project_data: serialized,
					project_version: project.version,
				}),
			});
		} else if (!putRes.ok) {
			throw new Error(`Failed to save project: ${putRes.status}`);
		}
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		const res = await apiFetch(`/api/projects/${id}`);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Failed to load project: ${res.status}`);

		const row = await res.json();
		const serialized = row.project_data as SerializedProject | null;

		if (!serialized) {
			// Row exists but no project_data yet — build minimal project
			return null;
		}

		return { project: toProject(serialized) };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const metadata = await this.loadAllProjectsMetadata();
		const projects = await Promise.all(
			metadata.map((m) => this.loadProject({ id: m.id })),
		);
		return projects.flatMap((r) => (r ? [r.project] : []));
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		const res = await apiFetch("/api/projects");
		if (!res.ok) throw new Error(`Failed to list projects: ${res.status}`);
		const rows = await res.json();

		return (rows as any[]).map((row) => ({
			id: row.id,
			name: row.name,
			thumbnail: row.thumbnail ?? undefined,
			duration: row.duration ?? 0,
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
		}));
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
	}

	// ── Media methods ────────────────────────────────────────────────────────

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		if (mediaAsset.ephemeral) return; // Ephemeral assets are not persisted

		const file = mediaAsset.file;
		const contentType = file.type || "application/octet-stream";

		// Request presigned upload URL
		const initRes = await apiFetch("/api/media", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				project_id: projectId,
				name: mediaAsset.name,
				type: mediaAsset.type,
				size: file.size,
				width: mediaAsset.width,
				height: mediaAsset.height,
				duration: mediaAsset.duration,
				fps: (mediaAsset as any).fps,
				content_type: contentType,
			}),
		});

		if (!initRes.ok) throw new Error(`Failed to init media upload: ${initRes.status}`);

		const { upload_url } = await initRes.json();

		// Upload file directly to R2 via presigned URL
		const uploadRes = await fetch(upload_url, {
			method: "PUT",
			body: file,
			headers: { "Content-Type": contentType },
		});

		if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const assets = await this.loadAllMediaAssets({ projectId });
		return assets.find((a) => a.id === id) ?? null;
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		const res = await apiFetch(`/api/media?project_id=${projectId}`);
		if (!res.ok) return [];

		const rows: any[] = await res.json();

		const assets = await Promise.all(
			rows.map(async (row) => {
				try {
					const fileRes = await fetch(row.public_url);
					if (!fileRes.ok) return null;

					const blob = await fileRes.blob();
					const file = new File([blob], row.name, { type: blob.type });
					const url = URL.createObjectURL(file);

					return {
						id: row.id,
						name: row.name,
						type: row.type,
						file,
						url,
						width: row.width,
						height: row.height,
						duration: row.duration,
						fps: row.fps,
						thumbnailUrl: undefined,
						ephemeral: false,
					} as MediaAsset;
				} catch {
					return null;
				}
			}),
		);

		return assets.filter((a): a is MediaAsset => a !== null);
	}

	async deleteMediaAsset({
		projectId: _projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		await apiFetch(`/api/media?id=${id}`, { method: "DELETE" });
	}

	async deleteProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		const res = await apiFetch(`/api/media?project_id=${projectId}`);
		if (!res.ok) return;
		const rows: any[] = await res.json();
		await Promise.all(rows.map((row) => this.deleteMediaAsset({ projectId, id: row.id })));
	}

	// ── Sounds (kept in localStorage for now) ────────────────────────────────

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const raw = localStorage.getItem("saved-sounds");
			return raw
				? JSON.parse(raw)
				: { sounds: [], lastModified: new Date().toISOString() };
		} catch {
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({ soundEffect }: { soundEffect: SoundEffect }): Promise<void> {
		const current = await this.loadSavedSounds();
		if (current.sounds.some((s) => s.id === soundEffect.id)) return;
		const saved: SavedSound = {
			id: soundEffect.id,
			name: soundEffect.name,
			username: soundEffect.username,
			previewUrl: soundEffect.previewUrl,
			downloadUrl: soundEffect.downloadUrl,
			duration: soundEffect.duration,
			tags: soundEffect.tags,
			license: soundEffect.license,
			savedAt: new Date().toISOString(),
		};
		const updated: SavedSoundsData = {
			sounds: [...current.sounds, saved],
			lastModified: new Date().toISOString(),
		};
		localStorage.setItem("saved-sounds", JSON.stringify(updated));
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		const current = await this.loadSavedSounds();
		const updated: SavedSoundsData = {
			sounds: current.sounds.filter((s) => s.id !== soundId),
			lastModified: new Date().toISOString(),
		};
		localStorage.setItem("saved-sounds", JSON.stringify(updated));
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		const current = await this.loadSavedSounds();
		return current.sounds.some((s) => s.id === soundId);
	}

	async clearSavedSounds(): Promise<void> {
		localStorage.removeItem("saved-sounds");
	}

	// ── Info / compat stubs ──────────────────────────────────────────────────

	async clearAllData(): Promise<void> {
		// Not implemented — dangerous operation
	}

	async getStorageInfo() {
		return { projects: 0, isOPFSSupported: false, isIndexedDBSupported: false };
	}

	async getProjectStorageInfo({ projectId: _projectId }: { projectId: string }) {
		return { mediaItems: 0 };
	}

	isOPFSSupported(): boolean { return false; }
	isIndexedDBSupported(): boolean { return false; }
	isFullySupported(): boolean { return true; }
}

export const apiStorageService = new ApiStorageService();
export { ApiStorageService };
