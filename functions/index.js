const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp();
const db = getFirestore('nocturne');

const geminiKey = defineSecret('GEMINI_API_KEY');

const getGeminiKey = () => geminiKey.value();

// Robust JSON parser — handles markdown-wrapped or thinking-prefixed responses
function parseGeminiJSON(rawText) {
  let text = rawText.trim();
  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  // Try parsing directly first
  try { return JSON.parse(text); } catch (_) {}
  // Try extracting the first JSON object
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Could not parse Gemini response as JSON: ' + text.slice(0, 200));
}

// ============================================================
// FUNCTION 1: generateGoalFromDream
// Called when user submits their morning dream entry
// ============================================================
exports.generateGoalFromDream = onRequest(
  { secrets: [geminiKey], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { dreamText, userId, entryId, refreshGoals, quickNotes } = req.body;

    if (!dreamText || !userId) {
      return res.status(400).json({ error: 'dreamText and userId are required' });
    }

    try {
      const today = new Date().toISOString().split('T')[0];

      // 0. If refreshing, delete existing AI goals for today
      if (refreshGoals) {
        const existingGoals = await db
          .collection('users').doc(userId)
          .collection('goals')
          .where('source', '==', 'ai')
          .where('dateString', '==', today)
          .get();
        if (!existingGoals.empty) {
          const deleteBatch = db.batch();
          existingGoals.docs.forEach(d => deleteBatch.delete(d.ref));
          await deleteBatch.commit();
        }
      }

      // 1. Fetch last 7 evening journal entries as context
      const journalsSnap = await db
        .collection('users').doc(userId)
        .collection('entries')
        .where('type', '==', 'journal')
        .orderBy('timestamp', 'desc')
        .limit(7)
        .get();

      const journalHistory = journalsSnap.docs.map(doc => {
        const d = doc.data();
        return `Date: ${d.dateString}\nEntry: ${d.text}\nMood: ${d.mood || 'unspecified'}`;
      }).join('\n\n---\n\n');

      // 1b. Fetch today's quick notes if not provided
      let notesContext = quickNotes || '';
      if (!notesContext) {
        const notesSnap = await db
          .collection('users').doc(userId)
          .collection('entries')
          .where('type', '==', 'note')
          .where('dateString', '==', today)
          .get();
        notesContext = notesSnap.docs.map(d => d.data().text).join('\n');
      }

      // 2. Call Gemini
      const genAI = new GoogleGenerativeAI(getGeminiKey());
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.8,
          maxOutputTokens: 4096,
        },
      });

      const prompt = buildDreamPrompt(dreamText, journalHistory, notesContext);
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();
      console.log('Gemini raw response (dream):', rawText.slice(0, 500));
      const parsed = parseGeminiJSON(rawText);

      // 3. Save AI result back to the dream entry
      if (entryId) {
        await db
          .collection('users').doc(userId)
          .collection('entries').doc(entryId)
          .update({
            aiResult: parsed,
            mood: parsed.mood || 'peaceful',
            aiProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }

      // 4. Batch-save goals to user's goals subcollection
      if (parsed.goals && Array.isArray(parsed.goals)) {
        const batch = db.batch();
        parsed.goals.forEach(goal => {
          const goalRef = db
            .collection('users').doc(userId)
            .collection('goals').doc();
          batch.set(goalRef, {
            text: goal.text,
            icon: goal.icon || '✨',
            why: goal.why || '',
            source: 'ai',
            sourceEntryId: entryId || null,
            completed: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            dateString: today,
            userId,
          });
        });
        await batch.commit();
      }

      return res.status(200).json(parsed);

    } catch (error) {
      console.error('generateGoalFromDream error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================================
// FUNCTION 2: processJournalEntry
// Called when user submits their evening journal
// ============================================================
exports.processJournalEntry = onRequest(
  { secrets: [geminiKey], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { journalText, userId, entryId, dateString } = req.body;

    if (!journalText || !userId) {
      return res.status(400).json({ error: 'journalText and userId are required' });
    }

    try {
      // 1. Get today's dream (if any)
      const todayDreamSnap = await db
        .collection('users').doc(userId)
        .collection('entries')
        .where('type', '==', 'dream')
        .where('dateString', '==', dateString)
        .limit(1)
        .get();

      const todayDream = todayDreamSnap.empty
        ? null
        : todayDreamSnap.docs[0].data().text;

      // 2. Get last 3 journal entries (excluding today) for context
      const recentSnap = await db
        .collection('users').doc(userId)
        .collection('entries')
        .where('type', '==', 'journal')
        .where('dateString', '<', dateString)
        .orderBy('dateString', 'desc')
        .limit(3)
        .get();

      const recentJournals = recentSnap.docs.map(doc => {
        const d = doc.data();
        return `Date: ${d.dateString}\nEntry: ${d.text}`;
      }).join('\n\n---\n\n');

      // 2b. Fetch today's quick notes
      const notesSnap = await db
        .collection('users').doc(userId)
        .collection('entries')
        .where('type', '==', 'note')
        .where('dateString', '==', dateString)
        .get();
      const todayNotes = notesSnap.docs.map(d => d.data().text).join('\n');

      // 3. Call Gemini
      const genAI = new GoogleGenerativeAI(getGeminiKey());
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.75,
          maxOutputTokens: 4096,
        },
      });

      const prompt = buildJournalPrompt(journalText, todayDream, recentJournals, todayNotes);
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();
      console.log('Gemini raw response (journal):', rawText.slice(0, 500));
      const parsed = parseGeminiJSON(rawText);

      // 4. Update the journal entry with AI result
      if (entryId) {
        await db
          .collection('users').doc(userId)
          .collection('entries').doc(entryId)
          .update({
            aiResult: parsed,
            mood: parsed.mood || 'peaceful',
            aiProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }

      return res.status(200).json(parsed);

    } catch (error) {
      console.error('processJournalEntry error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================================
// PROMPT BUILDERS
// ============================================================

function buildDreamPrompt(dreamText, journalHistory, quickNotes) {
  return `You are Nocturne, a compassionate and insightful journal companion. Your tone is warm, curious, and never prescriptive. You help people discover patterns in their inner life.

The user has just recorded their morning dream. You also have access to their recent evening journal entries and any quick notes they jotted down today.

RECENT JOURNAL ENTRIES (last 7 evenings):
${journalHistory || 'No previous entries yet — this is the first entry.'}

QUICK NOTES FROM TODAY:
${quickNotes || 'None'}

TODAY'S DREAM:
${dreamText}

Based on the dream and their journaling history, return a JSON object. Return ONLY valid JSON — no markdown, no explanation outside the JSON.

{
  "goals": [
    {
      "text": "A specific, gentle action this person could take today (15 words or fewer)",
      "icon": "A single relevant emoji",
      "why": "A brief personal explanation connecting this goal to their dream or patterns (20 words or fewer)"
    }
  ],
  "mood": "One word capturing the emotional tone of this dream (e.g. peaceful, curious, anxious, nostalgic, energetic, grateful, creative, calm, inspired, cozy, reflective)",
  "insight": "A 2-3 sentence reflection noticing a pattern or theme across the dream and recent entries. Be specific, warm, and observational — never prescriptive."
}

Generate exactly 3 goals. Make them specific to THIS person's content, not generic advice.`;
}

function buildJournalPrompt(journalText, todayDream, recentJournals, quickNotes) {
  return `You are Nocturne, a compassionate and insightful journal companion. Your tone is warm, curious, and never prescriptive.

The user has just written their evening journal entry. You have their dream from this morning, any quick notes they captured during the day, and recent past journal entries as context.

TODAY'S DREAM (recorded this morning):
${todayDream || 'No dream recorded today.'}

QUICK NOTES FROM TODAY:
${quickNotes || 'None'}

RECENT PAST JOURNAL ENTRIES:
${recentJournals || 'No previous entries yet — this is the first entry.'}

TODAY'S EVENING JOURNAL:
${journalText}

Return a JSON object. Return ONLY valid JSON — no markdown, no explanation outside the JSON.

{
  "goals": [
    {
      "text": "A specific, gentle intention for tomorrow (15 words or fewer)",
      "icon": "A single relevant emoji",
      "why": "A brief personal explanation connecting this to what they wrote today (20 words or fewer)"
    }
  ],
  "mood": "One word capturing the overall emotional tone of today's entry (e.g. peaceful, curious, anxious, nostalgic, energetic, grateful, creative, calm, inspired, cozy, reflective)",
  "insight": "A 2-3 sentence reflection on what stands out from today — connecting their dream, if any, to how their day unfolded. Be specific and warm."
}

Generate exactly 3 goals. Tailor them to this person's specific words and themes today.`;
}
