import type { LLMProvider } from './types'
import { callVisionApi } from './openai-compat'

const kimi: LLMProvider = {
  name: 'Kimi (Moonshot)',
  slug: 'moonshot',
  capabilities: ['image-to-text'],

  async imageToText(imagePath, language, apiKey) {
    return callVisionApi('https://api.moonshot.cn/v1', 'moonshot-v1-8k-vision', apiKey, imagePath, language)
  },
}

export default kimi
