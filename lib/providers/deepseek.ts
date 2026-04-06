import type { LLMProvider } from './types'
import { callVisionApi } from './openai-compat'

const deepseek: LLMProvider = {
  name: 'DeepSeek',
  slug: 'deepseek',
  capabilities: ['image-to-text'],

  async imageToText(imagePath, language, apiKey) {
    return callVisionApi('https://api.deepseek.com', 'deepseek-chat', apiKey, imagePath, language)
  },
}

export default deepseek
