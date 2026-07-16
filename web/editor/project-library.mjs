import { createVisualProject, parseVisualProject, serializeVisualProject } from './project-format.mjs'

export const PROJECT_LIBRARY_VERSION = 1
export const MAX_RECENT_PROJECTS = 8

export function parseProjectLibrary(text) {
  if (!text) return []
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch {
    return []
  }
  if (parsed?.version !== PROJECT_LIBRARY_VERSION || !Array.isArray(parsed.projects)) return []
  return parsed.projects.flatMap((candidate) => {
    try {
      return [parseVisualProject(typeof candidate === 'string' ? candidate : JSON.stringify(candidate))]
    } catch {
      return []
    }
  })
}

export function updateProjectLibrary(projects, project, limit = MAX_RECENT_PROJECTS) {
  const normalized = parseVisualProject(serializeVisualProject(project))
  return [normalized, ...projects.filter((candidate) => candidate.id !== normalized.id)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit)
}

export function serializeProjectLibrary(projects) {
  return JSON.stringify({ version: PROJECT_LIBRARY_VERSION, projects }, null, 2)
}

export function duplicateVisualProject(project, now = new Date().toISOString()) {
  const { id: _sourceId, ...source } = project
  return createVisualProject({
    ...source,
    name: `${project.name} のコピー`,
    workspace: project.workspace,
    assets: project.assets,
    settings: project.settings,
    createdAt: now,
    updatedAt: now,
  })
}

export function createRecoveryRecord(raw, error, now = new Date().toISOString()) {
  return {
    version: 1,
    capturedAt: now,
    error: String(error?.message ?? error),
    raw: String(raw ?? ''),
  }
}
