/**
 * vision.js — Riconoscimento alimenti da foto via AI
 *
 * Supporta: Claude (Anthropic) e Gemini (Google)
 * Provider selezionato via env var VISION_PROVIDER (default: claude)
 */

const SYSTEM_PROMPT = `Sei un nutrizionista esperto italiano. Analizza questa foto di cibo e identifica gli alimenti visibili.

REGOLE FONDAMENTALI:
1. SCOMPONI SEMPRE i piatti composti nei singoli ingredienti base. Esempi:
   - Lasagna al forno → pasta sfoglia all'uovo, ragù di carne, besciamella, parmigiano reggiano
   - Insalata mista → lattuga, pomodori, carote, olio extravergine di oliva
   - Panino con prosciutto → pane, prosciutto crudo, mozzarella
   - Pizza margherita → farina, mozzarella, pomodoro, olio extravergine di oliva
   NON restituire mai il piatto intero come singola voce.
2. Usa SEMPRE la forma CRUDA degli alimenti dove applicabile:
   - "Pasta di semola" NON "Pasta di semola cotta"
   - "Riso" NON "Riso cotto"
   - "Petto di pollo" NON "Petto di pollo cotto/alla griglia"
   Per la quantità, stima i grammi dell'alimento CRUDO (es. 80g di pasta cruda, non 160g di pasta cotta).
3. Usa nomi generici stile database CREA/INRAN italiano.
4. Stima quantità realistiche per ogni ingrediente.

Per ogni alimento fornisci:
- "name": nome italiano generico (CREA/INRAN), forma CRUDA
- "quantity_g": grammi stimati dell'ingrediente CRUDO
- "kcal_100g": calorie per 100g (del crudo)
- "protein_100g": proteine per 100g
- "fat_100g": grassi per 100g
- "carbs_100g": carboidrati per 100g
- "search_terms": array di 2-3 termini di ricerca alternativi in italiano

Rispondi SOLO con un JSON valido, senza markdown, senza commenti:
{"foods":[{"name":"...","quantity_g":...,"kcal_100g":...,"protein_100g":...,"fat_100g":...,"carbs_100g":...,"search_terms":["...","..."]}]}

Se non riesci a identificare alimenti, rispondi: {"foods":[]}`;

/**
 * Analizza un'immagine e restituisce gli alimenti riconosciuti
 * @param {Buffer} imageBuffer - Immagine come Buffer
 * @param {string} mimeType - Tipo MIME (image/jpeg, image/png, etc.)
 * @returns {Promise<Array<{name: string, quantity_g: number, search_terms: string[]}>>}
 */
async function recognizeFood(imageBuffer, mimeType = 'image/jpeg') {
  const provider = (process.env.VISION_PROVIDER || 'claude').toLowerCase();

  let result;
  if (provider === 'gemini') {
    result = await recognizeWithGemini(imageBuffer, mimeType);
  } else {
    result = await recognizeWithClaude(imageBuffer, mimeType);
  }

  return result;
}

async function recognizeWithClaude(imageBuffer, mimeType) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const base64 = imageBuffer.toString('base64');

  const response = await client.messages.create({
    model: process.env.VISION_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        },
        { type: 'text', text: SYSTEM_PROMPT }
      ]
    }]
  });

  const text = response.content[0]?.text || '{"foods":[]}';
  return parseResponse(text);
}

async function recognizeWithGemini(imageBuffer, mimeType) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.VISION_MODEL || 'gemini-2.0-flash'
  });

  const base64 = imageBuffer.toString('base64');

  const result = await model.generateContent([
    SYSTEM_PROMPT,
    { inlineData: { mimeType, data: base64 } }
  ]);

  const text = result.response.text() || '{"foods":[]}';
  return parseResponse(text);
}

function parseResponse(text) {
  try {
    // Rimuovi eventuali backtick markdown
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed.foods)) {
      return parsed.foods.map(f => ({
        name: f.name || '',
        quantity_g: Math.round(f.quantity_g || 0),
        kcal_100g: Math.round(f.kcal_100g || 0),
        protein_100g: Math.round((f.protein_100g || 0) * 10) / 10,
        fat_100g: Math.round((f.fat_100g || 0) * 10) / 10,
        carbs_100g: Math.round((f.carbs_100g || 0) * 10) / 10,
        search_terms: Array.isArray(f.search_terms) ? f.search_terms : []
      }));
    }
    return [];
  } catch (e) {
    console.error('Vision parse error:', e.message, 'Raw:', text);
    return [];
  }
}

module.exports = { recognizeFood };
