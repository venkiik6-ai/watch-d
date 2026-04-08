import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface WatchResult {
  is_watch: boolean;
  brand: string;
  model: string;
  normalized_name: string;
  confidence: "high" | "medium" | "low";
  functions?: string[];
  speciality?: string;
  strap_size?: string;
  dial_size?: string;
  strap_material?: string;
  battery: string;
  quantity: number;
  purchase_link?: string;
  estimated_price?: string;
  estimated_price_inr?: string;
}

const SYSTEM_PROMPT = `You are an intelligent assistant that helps identify wrist watches from images and provide their battery specifications.

You must follow a strict multi-step reasoning process.

STEP 1: WATCH IDENTIFICATION (IMAGE INPUT)
- Analyze the uploaded watch image carefully
- Identify: Brand, Model
- If exact model is unclear, provide the closest possible match

STEP 2: NORMALIZATION
- Normalize the watch name into a clean format (e.g., "Casio F-91 W" → "Casio F91W")

STEP 3: CONFIDENCE CHECK
- Assign confidence: high, medium, or low

STEP 4: BATTERY INFORMATION
- Provide battery type used in the watch
- Provide number of batteries required
- If unsure, return "unknown"
- Do NOT guess

STEP 5: OUTPUT FORMAT (STRICT JSON ONLY)
- Never return explanations
- Never return text outside JSON
- If unsure about battery → set "battery": "unknown"
- Prefer accuracy over guessing`;

export async function identifyWatch(base64Image: string): Promise<Partial<WatchResult>> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1] || base64Image,
            },
          },
          {
            text: "Identify this watch. Provide brand, model, normalized_name, confidence, a list of basic functions (e.g. ['Date', 'Chrono']), one unique speciality or fact, strap_size (lug width in mm), dial_size (case diameter in mm), and strap_material.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: "You are a watch identification expert. Normalize the name (e.g., 'Casio F-91 W' -> 'Casio F91W'). Return JSON only.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          is_watch: { type: Type.BOOLEAN, description: "Whether the image contains a wrist watch" },
          brand: { type: Type.STRING },
          model: { type: Type.STRING },
          normalized_name: { type: Type.STRING },
          confidence: { 
            type: Type.STRING,
            enum: ["high", "medium", "low"]
          },
          functions: { 
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          speciality: { type: Type.STRING },
          strap_size: { type: Type.STRING },
          dial_size: { type: Type.STRING },
          strap_material: { type: Type.STRING },
        },
        required: ["is_watch", "brand", "model", "normalized_name", "confidence", "functions", "speciality", "strap_size", "dial_size", "strap_material"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text);
}

export async function getBatteryInfo(brand: string, model: string): Promise<{ battery: string; quantity: number; purchase_link?: string; estimated_price?: string; estimated_price_inr?: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Provide battery specifications for the watch: ${brand} ${model}. Return JSON with 'battery' (type), 'quantity' (number), 'purchase_link' (a search link to buy this battery on an Indian website like Amazon.in or Flipkart), 'estimated_price' (approximate price in USD), and 'estimated_price_inr' (approximate price in Indian Rupees, e.g., '₹150'). If unknown, set battery to 'unknown'.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          battery: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          purchase_link: { type: Type.STRING },
          estimated_price: { type: Type.STRING },
          estimated_price_inr: { type: Type.STRING },
        },
        required: ["battery", "quantity"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text);
}
