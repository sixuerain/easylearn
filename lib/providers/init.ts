import { registerProvider } from './registry'
import openai from './openai'
import claude from './claude'
import gemini from './gemini'
import deepseek from './deepseek'
import kimi from './kimi'

let initialized = false

export function ensureProviders() {
  if (initialized) return
  registerProvider(openai)
  registerProvider(claude)
  registerProvider(gemini)
  registerProvider(deepseek)
  registerProvider(kimi)
  initialized = true
}
