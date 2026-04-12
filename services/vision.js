/**
 * vision.js — Riconoscimento alimenti da foto via AI
 *
 * Supporta: Claude (Anthropic) e Gemini (Google)
 * Provider selezionato via env var VISION_PROVIDER (default: claude)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PROMPT = `Sei un nutrizionista esperto italiano. Analizza questa foto di cibo e identifica gli alimenti visibili.

REGOLE FONDAMENTALI:
1. SCOMPONI SEMPRE i piatti composti nei singoli ingredienti base. Esempi:
   - Lasagna al forno → pasta sfoglia all'uovo, ragù di carne, besciamella, parmigiano reggiano
   - Insalata mista → lattuga, pomodori, carote, olio extravergine di oliva
   - Panino con prosciutto → pane, prosciutto crudo, mozzarella
   - Pizza margherita → farina, mozzarella, pomodoro, olio extravergine di oliva
   NON restituire mai il piatto intero come singola voce. Per identificare le ricette correttamente riferisciti a quelle presenti in siti come: giallozzaferano.it, fattoincasadabenedetta.it, cucchiaio.it,
2. Usa SEMPRE la forma CRUDA degli alimenti dove applicabile:
   - "Pasta di semola" NON "Pasta di semola cotta"
   - "Riso" NON "Riso cotto"
   - "Petto di pollo" NON "Petto di pollo cotto/alla griglia"
   Per la quantità, stima i grammi dell'alimento CRUDO (es. 80g di pasta cruda, non 160g di pasta cotta).
3. Usa nomi generici stile database CREA/INRAN italiano.
4. Stima quantità realistiche per ogni ingrediente.
5. ESCLUDI ingredienti con apporto calorico trascurabile rispetto al piatto (es. sale, pepe, spezie, erbe aromatiche, aceto, limone spremuto, aglio in piccole quantità). Includi solo ingredienti che contribuiscono significativamente alle calorie totali.

Per ogni alimento fornisci:
- "name": nome italiano generico (CREA/INRAN), forma CRUDA
- "quantity_g": grammi stimati dell'ingrediente CRUDO
- "kcal_100g": calorie per 100g (del crudo)
- "protein_100g": proteine per 100g
- "fat_100g": grassi per 100g
- "carbs_100g": carboidrati per 100g
- "search_terms": array di 2-3 termini di ricerca alternativi in italiano

Rispondi SOLO con un JSON valido, senza markdown, senza commenti.
Includi "dish_name" con il nome del piatto identificato (es. "Lasagne alla bolognese", "Pasta al pomodoro", "Insalata caprese"). Se ci sono più piatti, descrivili tutti separati da " + " (es. "Petto di pollo alla griglia + Insalata mista").

{"dish_name":"...","foods":[{"name":"...","quantity_g":...,"kcal_100g":...,"protein_100g":...,"fat_100g":...,"carbs_100g":...,"search_terms":["...","..."]}]}

Se non riesci a identificare alimenti, rispondi: {"dish_name":"","foods":[]}`;

const PROMPT_FILE = path.join(__dirname, '..', 'vision-prompt.txt');

function getPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      const custom = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
      if (custom) return custom;
    }
  } catch (e) { /* fallback al default */ }
  return DEFAULT_PROMPT;
}

/**
 * Analizza una descrizione testuale e restituisce gli alimenti identificati
 * @param {string} text - Descrizione del piatto in testo libero
 * @returns {Promise<{dish_name: string, foods: Array}>}
 */
async function describeDish(text) {
  const provider = (process.env.VISION_PROVIDER || 'claude').toLowerCase();
  return provider === 'gemini'
    ? describeWithGemini(text)
    : describeWithClaude(text);
}

async function describeWithClaude(text) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.VISION_MODEL || 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: getPrompt() + '\n\nDESCRIZIONE UTENTE: ' + text }]
  });
  return parseResponse(response.content[0]?.text || '{"foods":[]}');
}

async function describeWithGemini(text) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.VISION_MODEL || 'gemini-2.5-flash'
  });
  const result = await model.generateContent([getPrompt() + '\n\nDESCRIZIONE UTENTE: ' + text]);
  return parseResponse(result.response.text() || '{"foods":[]}');
}

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
    model: process.env.VISION_MODEL || 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        },
        { type: 'text', text: getPrompt() }
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
    model: process.env.VISION_MODEL || 'gemini-2.5-flash'
  });

  const base64 = imageBuffer.toString('base64');

  const result = await model.generateContent([
    getPrompt(),
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
      const foods = parsed.foods.map(f => ({
        name: f.name || '',
        quantity_g: Math.round(f.quantity_g || 0),
        kcal_100g: Math.round(f.kcal_100g || 0),
        protein_100g: Math.round((f.protein_100g || 0) * 10) / 10,
        fat_100g: Math.round((f.fat_100g || 0) * 10) / 10,
        carbs_100g: Math.round((f.carbs_100g || 0) * 10) / 10,
        search_terms: Array.isArray(f.search_terms) ? f.search_terms : []
      }));
      return { dish_name: parsed.dish_name || '', foods };
    }
    return { dish_name: '', foods: [] };
  } catch (e) {
    console.error('Vision parse error:', e.message, 'Raw:', text);
    return { dish_name: '', foods: [] };
  }
}

module.exports = { recognizeFood, describeDish, getPrompt, DEFAULT_PROMPT };
