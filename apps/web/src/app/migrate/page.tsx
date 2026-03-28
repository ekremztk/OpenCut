"use client";

/**
 * One-time migration helper: imports existing IndexedDB projects into Supabase.
 * After migration is complete, this page can be removed.
 */

import { useState } from "react";
import { legacyStorageService, storageService } from "@/services/storage/service";
import type { TProject } from "@/types/project";

type MigrationStatus = "idle" | "scanning" | "migrating" | "done" | "error";

interface ProjectMigrationResult {
	id: string;
	name: string;
	status: "ok" | "skip" | "error";
	error?: string;
}

export default function MigratePage() {
	const [status, setStatus] = useState<MigrationStatus>("idle");
	const [results, setResults] = useState<ProjectMigrationResult[]>([]);
	const [log, setLog] = useState<string[]>([]);

	const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

	const handleMigrate = async () => {
		setStatus("scanning");
		setResults([]);
		setLog([]);
		addLog("Scanning IndexedDB for existing projects...");

		let projects: TProject[] = [];

		try {
			projects = await legacyStorageService.loadAllProjects();
			addLog(`Found ${projects.length} project(s) in IndexedDB.`);
		} catch (err) {
			addLog(`Error reading IndexedDB: ${err}`);
			setStatus("error");
			return;
		}

		if (projects.length === 0) {
			addLog("Nothing to migrate.");
			setStatus("done");
			return;
		}

		setStatus("migrating");
		const migrationResults: ProjectMigrationResult[] = [];

		for (const project of projects) {
			addLog(`Migrating "${project.metadata.name}" (${project.metadata.id})...`);

			try {
				// Save project data
				await storageService.saveProject({ project });

				// Migrate media assets
				let mediaCount = 0;
				try {
					const mediaAssets = await legacyStorageService.loadAllMediaAssets({
						projectId: project.metadata.id,
					});
					addLog(`  → ${mediaAssets.length} media asset(s) found`);

					for (const asset of mediaAssets) {
						if (asset.ephemeral) {
							addLog(`  → Skipping ephemeral asset: ${asset.name}`);
							continue;
						}
						try {
							await storageService.saveMediaAsset({
								projectId: project.metadata.id,
								mediaAsset: asset,
							});
							mediaCount++;
							addLog(`  → Uploaded: ${asset.name}`);
						} catch (assetErr) {
							addLog(`  → Failed to upload ${asset.name}: ${assetErr}`);
						}
					}
				} catch (mediaErr) {
					addLog(`  → Could not load media: ${mediaErr}`);
				}

				addLog(`  ✓ Done (${mediaCount} media file(s) uploaded)`);
				migrationResults.push({ id: project.metadata.id, name: project.metadata.name, status: "ok" });
			} catch (err) {
				addLog(`  ✗ Failed: ${err}`);
				migrationResults.push({
					id: project.metadata.id,
					name: project.metadata.name,
					status: "error",
					error: String(err),
				});
			}
		}

		setResults(migrationResults);
		setStatus("done");
		addLog("Migration complete.");
	};

	const okCount = results.filter((r) => r.status === "ok").length;
	const errCount = results.filter((r) => r.status === "error").length;

	return (
		<div className="min-h-screen bg-background p-8 max-w-2xl mx-auto">
			<h1 className="text-xl font-semibold mb-2">Project Migration</h1>
			<p className="text-sm text-muted-foreground mb-6">
				Imports your existing local projects (IndexedDB) into the cloud (Supabase + R2).
				Run this once. Your local data will not be deleted.
			</p>

			<button
				type="button"
				onClick={handleMigrate}
				disabled={status === "scanning" || status === "migrating"}
				className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity mb-6"
			>
				{status === "scanning"
					? "Scanning..."
					: status === "migrating"
						? "Migrating..."
						: "Start Migration"}
			</button>

			{status === "done" && results.length > 0 && (
				<div className="mb-4 p-3 rounded-md bg-muted text-sm">
					{okCount} migrated, {errCount} failed.
				</div>
			)}

			{status === "done" && results.length === 0 && (
				<div className="mb-4 p-3 rounded-md bg-muted text-sm text-muted-foreground">
					No projects found in local storage.
				</div>
			)}

			{log.length > 0 && (
				<div className="rounded-md border border-border bg-muted/30 p-4 font-mono text-xs space-y-0.5 max-h-96 overflow-y-auto">
					{log.map((line, i) => (
						<div key={i}>{line}</div>
					))}
				</div>
			)}
		</div>
	);
}
