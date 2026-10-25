import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

// DSH_PLUGIN_ESBUILD overrides the API module path, not the platform-specific .bin shim.
export function resolveEsbuildModule(root, env = process.env) {
  const require = createRequire(join(root, 'package.json'))
  return env.DSH_PLUGIN_ESBUILD
    ? resolve(env.DSH_PLUGIN_ESBUILD)
    : require.resolve('esbuild')
}

export function loadEsbuild(root, env = process.env) {
  const require = createRequire(join(root, 'package.json'))
  try {
    return require(resolveEsbuildModule(root, env))
  } catch (error) {
    if (!env.DSH_PLUGIN_ESBUILD
      && error?.code === 'MODULE_NOT_FOUND'
      && error.message.includes("Cannot find module 'esbuild'")) return null
    throw error
  }
}
