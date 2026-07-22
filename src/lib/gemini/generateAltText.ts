import type { GoogleGenerativeAI } from '@google/generative-ai';
import { ALT_TEXT_SYSTEM_PROMPT } from './systemPrompt';
import { DEFAULT_MODEL } from './models';

export interface GenerateAltTextInput {
  imageBuffer: Buffer;
  mimeType: string;
  productName: string;
  reviewerHint?: string;
  model?: string;
}

export async function generateAltText(
  client: GoogleGenerativeAI,
  input: GenerateAltTextInput
): Promise<string> {
  const model = client.getGenerativeModel({
    model: input.model ?? DEFAULT_MODEL,
    systemInstruction: ALT_TEXT_SYSTEM_PROMPT,
  });

  const promptText = input.reviewerHint
    ? `Product name: ${input.productName}\n\nA human reviewer left this correction about the image: ${input.reviewerHint}\n\nTake this into account and write the alt text for this product image.`
    : `Product name: ${input.productName}\n\nWrite the alt text for this product image.`;

  const result = await model.generateContent([
    { inlineData: { data: input.imageBuffer.toString('base64'), mimeType: input.mimeType } },
    { text: promptText },
  ]);

  const text = result.response.text().trim();
  if (!text) {
    throw new Error('Gemini returned an empty alt text response');
  }

  return text;
}
