// AI triage. Claude reads each report (text, transcript, and a photo or video
// frame when there is one) and returns structured fields. Every call has a
// keyword fallback so the app keeps working without an API key or network.

import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CATEGORY_KEYS, CATEGORIES, keywordCategory, keywordSeverity, CHIP_TO_CATEGORY } from './categories.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

export const aiEnabled = () => Boolean(client);

const ReportTriage = z.object({
  category: z.enum(CATEGORY_KEYS),
  severity: z.number().int().describe('1 = minor nuisance, 3 = active hazard, 5 = life at risk right now'),
  title: z.string().describe('2 to 5 words, e.g. "Flames behind houses"'),
  summary: z.string().describe('One plain sentence of what the resident reports. No speculation.'),
  people_at_risk: z.boolean(),
});

const IncidentSummary = z.object({
  title: z.string().describe('2 to 4 words naming the incident, e.g. "Wildfire smoke"'),
  summary: z.string().describe('2 to 3 short factual sentences for a dispatcher.'),
});

const TRIAGE_SYSTEM = `You triage resident reports sent to a city emergency team.
Pick the single best category: ${CATEGORY_KEYS.map((k) => `${k} (${CATEGORIES[k].label})`).join(', ')}.
Use "fire" when flames are visible or described, "smoke" when only smoke, ash, or a burning smell is.
Rate severity from what the report shows, not from what might happen.
Write for a busy dispatcher: short, factual, no filler. Never invent details that are not in the report or image.`;

const SUMMARY_SYSTEM = `You summarize clusters of resident reports for a city emergency dispatcher.
State how many residents reported, what they describe, since when, and what photos or video show.
Mention people at risk only if a report says so. Plain sentences, no speculation, no advice.`;

async function callClaude({ system, content, schema, maxTokens = 2000 }) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}

function imageBlock(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = filePath.split('.').pop().toLowerCase();
  const mediaType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext];
  if (!mediaType) return null;
  const data = fs.readFileSync(filePath);
  if (data.length > 4.5 * 1024 * 1024) return null;
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } };
}

function reportText(r) {
  const parts = [`Report type: ${r.kind}`];
  if (r.chips?.length) parts.push(`Resident tapped: ${r.chips.join(', ')}`);
  if (r.flags?.length) parts.push(`Help flags: ${r.flags.join(', ')}`);
  if (r.text) parts.push(`Text: ${r.text}`);
  if (r.transcript) parts.push(`Voice transcript: ${r.transcript}`);
  if (r.address) parts.push(`Near: ${r.address}`);
  return parts.join('\n');
}

function fallbackTriage(r) {
  const words = `${r.text || ''} ${r.transcript || ''}`;
  const chipCat = (r.chips || []).map((c) => CHIP_TO_CATEGORY[c]).find(Boolean);
  const category = chipCat || keywordCategory(words);
  const severity = keywordSeverity(words, r.flags || []);
  const clean = words.trim().replace(/\s+/g, ' ');
  return {
    category,
    severity,
    title: clean ? clean.split(' ').slice(0, 5).join(' ') : `${CATEGORIES[category].label} report`,
    summary: clean || `${CATEGORIES[category].label} reported from a ${r.kind}.`,
    people_at_risk: severity >= 4,
    source: 'keywords',
  };
}

export async function triageReport(r) {
  if (client) {
    try {
      const content = [];
      const img = imageBlock(r.kind === 'photo' ? r.media_path : r.thumb_path);
      if (img) content.push(img);
      content.push({ type: 'text', text: reportText(r) });
      const out = await callClaude({ system: TRIAGE_SYSTEM, content, schema: ReportTriage });
      if (out) return { ...out, severity: Math.min(5, Math.max(1, out.severity)), source: 'claude' };
    } catch (err) {
      console.warn('[triage] Claude call failed, using keywords:', err.message);
    }
  }
  return fallbackTriage(r);
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.TZ_DISPLAY || 'America/Los_Angeles' });
}

function fallbackSummary(incident, reports) {
  const n = reports.length;
  const first = Math.min(...reports.map((r) => r.created_at));
  const photos = reports.filter((r) => r.kind === 'photo').length;
  const videos = reports.filter((r) => r.kind === 'video').length;
  const label = CATEGORIES[incident.category].label.toLowerCase();
  let s = `${n} resident${n === 1 ? '' : 's'} reported ${label}${incident.place ? ` near ${incident.place}` : ''} since ${fmtTime(first)}.`;
  if (photos || videos) s += ` ${photos} photo${photos === 1 ? '' : 's'} and ${videos} video${videos === 1 ? '' : 's'} attached.`;
  if (reports.some((r) => r.urgent)) s += ' At least one person in this area asked for help.';
  const autoTitle = !incident.title || Object.values(CATEGORIES).some((c) => c.label === incident.title);
  const keepTitle = !autoTitle && incident.title;
  return { title: keepTitle || CATEGORIES[incident.category].label, summary: s, source: 'template' };
}

export async function summarizeIncident(incident, reports) {
  if (client && reports.length) {
    try {
      const lines = reports
        .slice(-40)
        .map((r) => `[${fmtTime(r.created_at)}] ${r.kind}${r.urgent ? ' (asked for help)' : ''}: ${r.ai_summary || r.text || r.transcript || '(no text)'}`);
      const text = `Incident category: ${incident.category}. Location: ${incident.place || 'unknown'}.
Total reports: ${reports.length}.
Reports, oldest first:
${lines.join('\n')}`;
      const out = await callClaude({ system: SUMMARY_SYSTEM, content: [{ type: 'text', text }], schema: IncidentSummary });
      if (out) return { ...out, source: 'claude' };
    } catch (err) {
      console.warn('[summary] Claude call failed, using template:', err.message);
    }
  }
  return fallbackSummary(incident, reports);
}
