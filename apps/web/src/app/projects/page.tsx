"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { storageService } from "@/services/storage/service";
import type { TProjectMetadata } from "@/types/project";
import { generateUUID } from "@/utils/id";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Film, Trash2, Clock } from "lucide-react";

function formatDate(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(date));
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ProjectsPage() {
	const router = useRouter();
	const [projects, setProjects] = useState<TProjectMetadata[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleting, setDeleting] = useState<string | null>(null);

	useEffect(() => {
		storageService
			.loadAllProjectsMetadata()
			.then((data) => {
				const sorted = [...data].sort(
					(a, b) =>
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
				setProjects(sorted);
			})
			.finally(() => setLoading(false));
	}, []);

	const handleNewProject = () => {
		router.push(`/editor/${generateUUID()}`);
	};

	const handleOpenProject = (id: string) => {
		router.push(`/editor/${id}`);
	};

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		setDeleting(id);
		try {
			await storageService.deleteProject({ id });
			setProjects((prev) => prev.filter((p) => p.id !== id));
		} finally {
			setDeleting(null);
		}
	};

	return (
		<div className="min-h-screen bg-background text-foreground">
			{/* Header */}
			<div className="border-b border-border px-8 py-5 flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Prognot Editor</h1>
					<p className="text-sm text-muted-foreground mt-0.5">Your projects</p>
				</div>
				<Button onClick={handleNewProject} className="gap-2">
					<Plus className="size-4" />
					New Project
				</Button>
			</div>

			{/* Content */}
			<div className="px-8 py-8">
				{loading ? (
					<div className="flex items-center justify-center py-24">
						<Spinner className="size-6" />
					</div>
				) : projects.length === 0 ? (
					/* Empty state */
					<div className="flex flex-col items-center justify-center py-24 gap-4">
						<div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
							<Film className="size-8 text-muted-foreground" />
						</div>
						<div className="text-center">
							<p className="font-medium">No projects yet</p>
							<p className="text-sm text-muted-foreground mt-1">
								Create a new project to get started
							</p>
						</div>
						<Button onClick={handleNewProject} className="gap-2 mt-2">
							<Plus className="size-4" />
							New Project
						</Button>
					</div>
				) : (
					/* Project grid */
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
						{/* New project card */}
						<button
							type="button"
							onClick={handleNewProject}
							className="group flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 aspect-video hover:bg-muted/60 hover:border-muted-foreground/40 transition-colors cursor-pointer"
						>
							<Plus className="size-6 text-muted-foreground group-hover:text-foreground transition-colors" />
							<span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
								New Project
							</span>
						</button>

						{/* Project cards */}
						{projects.map((project) => (
							<button
								key={project.id}
								type="button"
								onClick={() => handleOpenProject(project.id)}
								className="group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden hover:border-muted-foreground/40 transition-colors cursor-pointer text-left"
							>
								{/* Thumbnail */}
								<div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
									{project.thumbnail ? (
										<img
											src={project.thumbnail}
											alt={project.name}
											className="w-full h-full object-cover"
										/>
									) : (
										<Film className="size-8 text-muted-foreground/40" />
									)}
								</div>

								{/* Info */}
								<div className="px-3 py-2.5 flex-1">
									<p className="text-sm font-medium truncate">{project.name}</p>
									<div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
										<Clock className="size-3" />
										<span>{formatDate(project.updatedAt)}</span>
										{project.duration > 0 && (
											<>
												<span>·</span>
												<span>{formatDuration(project.duration)}</span>
											</>
										)}
									</div>
								</div>

								{/* Delete button */}
								<button
									type="button"
									onClick={(e) => handleDelete(e, project.id)}
									disabled={deleting === project.id}
									className="absolute top-2 right-2 size-7 rounded-md bg-background/80 backdrop-blur-sm border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
								>
									{deleting === project.id ? (
										<Spinner className="size-3" />
									) : (
										<Trash2 className="size-3.5" />
									)}
								</button>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
