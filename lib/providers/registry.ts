import type { LLMProvider, Capability } from './types'

const providers = new Map<string, LLMProvider>()

export function registerProvider(p: LLMProvider) {
  providers.set(p.slug, p)
}

export function getProvider(slug: string): LLMProvider | undefined {
  return providers.get(slug)
}

export function allProviders(): LLMProvider[] {
  return [...providers.values()]
}

export function providersWithCapability(cap: Capability): LLMProvider[] {
  return allProviders().filter(p => p.capabilities.includes(cap))
}
