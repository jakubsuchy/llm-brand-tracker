// Canonical model metadata — used by both server and client
export const MODEL_META: Record<string, {
  label: string;
  color: string;  // brand-inspired color for charts
  icon: string;
  description: string;
}> = {
  chatgpt: {
    label: 'ChatGPT',
    color: 'hsl(172, 66%, 40%)',  // OpenAI teal
    icon: '💬',
    description: 'Browser-based. Supports anonymous and authenticated mode. Returns responses with sources.',
  },
  perplexity: {
    label: 'Perplexity',
    color: 'hsl(220, 70%, 55%)', // Perplexity blue
    icon: '🔍',
    description: 'Browser-based. Uses residential proxy. Returns responses with source citations.',
  },
  gemini: {
    label: 'Google Gemini',
    color: 'hsl(217, 90%, 60%)', // Google blue
    icon: '✨',
    description: 'Browser-based. Google AI responses with grounding sources.',
  },
  'google-aimode': {
    label: 'Google AI Mode',
    color: 'hsl(36, 90%, 55%)',  // Google yellow-orange
    icon: '🌐',
    description: 'Browser-based. Google Search AI Mode with web-grounded responses.',
  },
};

export function getModelColor(model: string): string {
  return MODEL_META[model]?.color || `hsl(${Math.abs(hashCode(model)) % 360}, 50%, 55%)`;
}

export function getModelLabel(model: string): string {
  return MODEL_META[model]?.label || model;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
