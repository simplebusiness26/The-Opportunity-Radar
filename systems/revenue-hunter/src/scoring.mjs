export const DEFAULT_WEIGHTS = Object.freeze({
  pain: 0.20,
  buyerClarity: 0.14,
  speedToCash: 0.18,
  deliveryEase: 0.12,
  evidence: 0.14,
  margin: 0.12,
  contactability: 0.10,
});

export function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : 0));
}

export function scoreProspect(input, weights = DEFAULT_WEIGHTS) {
  const components = {
    pain: clamp(input.pain),
    buyerClarity: clamp(input.buyerClarity),
    speedToCash: clamp(input.speedToCash),
    deliveryEase: clamp(input.deliveryEase),
    evidence: clamp(input.evidence),
    margin: clamp(input.margin),
    contactability: clamp(input.contactability),
  };
  const total = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);
  return { total: Math.round(total * 10) / 10, components };
}

export function inferOpportunitySignals({ markdown = '', links = [], website = '' }) {
  if (!website) {
    return {
      findings: [{
        code: 'NO_WEBSITE', severity: 92,
        title: 'No discoverable business website',
        solution: 'mobile-first local business website with quote capture'
      }],
      flags: { noWebsite: true, hasBooking: false, hasQuote: false, hasContact: false, hasForm: false, hasWhatsapp: false, hasStrongCta: false, hasHttps: false, thin: true }
    };
  }

  const text = `${markdown} ${links.join(' ')}`.toLowerCase();
  const hasBooking = /(book|appointment|schedule|reserve|calendly)/.test(text);
  const hasQuote = /(quote|estimate|quotation)/.test(text);
  const hasContact = /(contact|tel:|mailto:)/.test(text);
  const hasForm = /(<form|formspree|typeform|jotform|hubspot)/.test(text);
  const hasWhatsapp = /(wa\.me|whatsapp)/.test(text);
  const hasStrongCta = /(get started|request|book now|free quote|call now|contact us)/.test(text);
  const hasHttps = /^https:\/\//i.test(website || '');
  const thin = markdown.trim().length < 1200;

  const findings = [];
  if (!hasQuote) findings.push({ code: 'NO_QUOTE_FLOW', severity: 78, title: 'No obvious quote flow', solution: 'guided quote/intake funnel' });
  if (!hasBooking) findings.push({ code: 'NO_BOOKING_FLOW', severity: 68, title: 'No obvious booking flow', solution: 'booking/availability funnel' });
  if (!hasForm) findings.push({ code: 'NO_STRUCTURED_FORM', severity: 72, title: 'No detectable structured enquiry form', solution: 'structured lead capture form' });
  if (!hasStrongCta) findings.push({ code: 'WEAK_CTA', severity: 62, title: 'Weak or unclear conversion call-to-action', solution: 'conversion-focused landing section' });
  if (!hasContact) findings.push({ code: 'CONTACT_FRICTION', severity: 84, title: 'Contact route is hard to detect', solution: 'prominent contact and callback flow' });
  if (!hasWhatsapp) findings.push({ code: 'NO_FAST_MESSAGE', severity: 45, title: 'No fast-message route detected', solution: 'optional fast-message handoff' });
  if (!hasHttps) findings.push({ code: 'NO_HTTPS', severity: 90, title: 'Website URL is not HTTPS', solution: 'secure HTTPS setup' });
  if (thin) findings.push({ code: 'THIN_SITE', severity: 52, title: 'Site appears thin or low-information', solution: 'focused trust-and-conversion page' });

  return { findings, flags: { noWebsite: false, hasBooking, hasQuote, hasContact, hasForm, hasWhatsapp, hasStrongCta, hasHttps, thin } };
}

export function chooseBestFinding(findings = []) {
  return [...findings].sort((a, b) => b.severity - a.severity)[0] ?? {
    code: 'GENERAL_CONVERSION', severity: 40, title: 'Conversion journey can be improved', solution: 'conversion-focused enquiry flow'
  };
}

export function priceOffer({ score = 50, severity = 50, deliveryEase = 70 }) {
  const base = 180;
  const value = score * 3.2 + severity * 2.2 + deliveryEase * 1.2;
  const rounded = Math.round((base + value) / 50) * 50;
  return Math.max(250, Math.min(1250, rounded));
}
