import type { GoogleGenerativeAI } from '@google/generative-ai';
import { ALT_TEXT_SYSTEM_PROMPT } from './systemPrompt';

export interface GenerateAltTextInput {
  imageBuffer: Buffer;
  mimeType: string;
  productName: string;
}

const MODEL_NAME = 'gemini-2.0-flash';

export async function generateAltText(
  client: GoogleGenerativeAI,
  input: GenerateAltTextInput
): Promise<string> {
  const model = client.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: ALT_TEXT_SYSTEM_PROMPT,
  });

  const result = await model.generateContent([
    { inlineData: { data: input.imageBuffer.toString('base64'), mimeType: input.mimeType } },
    { text: `Product name: ${input.productName}\n\nWrite the alt text for this product image.` },
  ]);

  return result.response.text().trim();
}
