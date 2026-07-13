import { GoogleGenerativeAI } from '@google/generative-ai';

export function createGeminiClient(apiKey: string): GoogleGenerativeAI {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return new GoogleGenerativeAI(apiKey);
}
