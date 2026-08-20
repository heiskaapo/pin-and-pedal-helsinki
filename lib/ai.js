const { GoogleGenAI } = require('@google/genai');
const { config } = require('./config');

let client;
function ai() {
  if (!config.projectId) throw Object.assign(new Error('Vertex AI is not configured'), { code: 'CONFIG' });
  if (!client) client = new GoogleGenAI({ vertexai: true, project: config.projectId, location: config.vertexLocation });
  return client;
}

async function recommendSlots(options) {
  if (!options.length) return null;
  try {
    const response = await ai().models.generateContent({
      model: config.geminiModel,
      contents: `You are a Helsinki bike repair logistics assistant. Choose one option only from this deterministic, already-validated list: ${JSON.stringify(options.map(option => ({ id: option.id, time: option.label, priceEur: option.price, detourMinutes: option.detourMinutes })))}. Return JSON with recommendedOptionId and a customer-friendly reason under 25 words. Prices are euros: write them as € followed by the number. Do not invent another time or price.`,
      config: { responseMimeType: 'application/json', temperature: 0.1 }
    });
    const result = JSON.parse(response.text);
    if (!options.some(option => option.id === result.recommendedOptionId)) return null;
    return { recommendedOptionId: result.recommendedOptionId, reason: String(result.reason || '').replace(/\$(\d+)/g, '€$1').slice(0, 180) };
  } catch (error) {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'vertex_slot_recommendation_failed', message: error.message }));
    return null;
  }
}

async function draftMarketing({ area, completedAt, publicPhotoAvailable }) {
  const safeInput = { area: area || 'Helsinki/Espoo', completedAt, publicPhotoAvailable: Boolean(publicPhotoAvailable) };
  try {
    const response = await ai().models.generateContent({
      model: config.geminiModel,
      contents: `Write a friendly social caption under 60 words for Pin & Pedal after a completed puncture repair. Use only this public-safe JSON: ${JSON.stringify(safeInput)}. Do not imply consent to publish a customer or bicycle photo. Return JSON with title and caption.`,
      config: { responseMimeType: 'application/json', temperature: 0.4 }
    });
    const result = JSON.parse(response.text);
    return { title: String(result.title || '').slice(0, 100), caption: String(result.caption || '').slice(0, 500), generatedBy: config.geminiModel };
  } catch (error) {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'vertex_marketing_draft_failed', message: error.message }));
    return {
      title: `Bike rescue completed in ${safeInput.area}`,
      caption: `Another rider is rolling again after a same-day puncture repair in ${safeInput.area}.`,
      generatedBy: 'deterministic-fallback'
    };
  }
}

module.exports = { draftMarketing, recommendSlots };
