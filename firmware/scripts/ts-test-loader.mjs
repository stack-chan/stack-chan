import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.endsWith('.ts')) {
    return defaultResolve(specifier, context, defaultResolve)
  }
  return defaultResolve(specifier, context, defaultResolve)
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.ts')) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
      },
      fileName: fileURLToPath(url),
    })
    return {
      format: 'module',
      source: outputText,
      shortCircuit: true,
    }
  }
  return defaultLoad(url, context, defaultLoad)
}
