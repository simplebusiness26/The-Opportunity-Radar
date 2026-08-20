export const OPPORTUNITY_LIBRARY = Object.freeze({
  NO_WEBSITE: { label: 'New conversion website', solution: 'mobile-first conversion website', effortMinutes: 300, typicalPrice: 750, recurringPotential: 25, marginScore: 82, demoType: 'website' },
  NO_QUOTE_FLOW: { label: 'Quote funnel', solution: 'guided quote and job-intake funnel', effortMinutes: 150, typicalPrice: 550, recurringPotential: 20, marginScore: 90, demoType: 'quote' },
  NO_BOOKING_FLOW: { label: 'Booking flow', solution: 'booking and availability funnel', effortMinutes: 180, typicalPrice: 600, recurringPotential: 30, marginScore: 84, demoType: 'booking' },
  NO_STRUCTURED_FORM: { label: 'Lead capture', solution: 'structured enquiry and callback flow', effortMinutes: 120, typicalPrice: 450, recurringPotential: 20, marginScore: 92, demoType: 'form' },
  WEAK_CTA: { label: 'Conversion landing page', solution: 'conversion-focused landing page and CTA system', effortMinutes: 120, typicalPrice: 450, recurringPotential: 15, marginScore: 90, demoType: 'landing' },
  CONTACT_FRICTION: { label: 'Contact recovery', solution: 'prominent contact, callback and fast-message journey', effortMinutes: 90, typicalPrice: 350, recurringPotential: 20, marginScore: 94, demoType: 'contact' },
  NO_FAST_MESSAGE: { label: 'Fast enquiry channel', solution: 'fast-message and callback handoff', effortMinutes: 60, typicalPrice: 300, recurringPotential: 15, marginScore: 95, demoType: 'contact' },
  THIN_SITE: { label: 'Trust and service page', solution: 'service, proof and conversion content rebuild', effortMinutes: 180, typicalPrice: 550, recurringPotential: 10, marginScore: 82, demoType: 'website' },
  NO_HTTPS: { label: 'Website security fix', solution: 'secure HTTPS and deployment setup', effortMinutes: 75, typicalPrice: 300, recurringPotential: 5, marginScore: 86, demoType: 'technical' },
  MOBILE_FRICTION: { label: 'Mobile conversion rebuild', solution: 'mobile-first responsive conversion rebuild', effortMinutes: 210, typicalPrice: 650, recurringPotential: 20, marginScore: 85, demoType: 'website' },
  DEAD_LINKS: { label: 'Website repair', solution: 'broken-link and customer-journey repair', effortMinutes: 90, typicalPrice: 300, recurringPotential: 10, marginScore: 88, demoType: 'technical' },
  NO_EMAIL: { label: 'Contact capture upgrade', solution: 'clear email/contact and enquiry routing', effortMinutes: 60, typicalPrice: 250, recurringPotential: 10, marginScore: 92, demoType: 'contact' },
  INSPECTION_FAILED: { label: 'Manual conversion audit', solution: 'manual conversion audit and mobile-first concept', effortMinutes: 120, typicalPrice: 400, recurringPotential: 10, marginScore: 80, demoType: 'website' },
  GENERAL_CONVERSION: { label: 'Conversion improvement', solution: 'conversion-focused customer journey', effortMinutes: 180, typicalPrice: 550, recurringPotential: 15, marginScore: 82, demoType: 'website' }
});

export function opportunityFor(code = 'GENERAL_CONVERSION') {
  return OPPORTUNITY_LIBRARY[code] || OPPORTUNITY_LIBRARY.GENERAL_CONVERSION;
}

export function commercialEstimate({ code, score = 50, severity = 50 }) {
  const o = opportunityFor(code);
  const price = Math.round((o.typicalPrice * (0.72 + Number(score || 0) / 250) + Number(severity || 0) * 1.2) / 50) * 50;
  const deliveryCost = Math.round((o.effortMinutes / 60) * 18);
  const expectedMargin = Math.max(0, price - deliveryCost);
  return { ...o, price: Math.max(250, Math.min(1800, price)), deliveryCost, expectedMargin };
}

export function chooseOpportunity(findings = []) {
  const ranked = [...findings].map(f => {
    const o = opportunityFor(f.code);
    const commercial = Number(f.severity || 0) * 0.6 + o.marginScore * 0.25 + Math.max(0, 100 - o.effortMinutes / 5) * 0.15;
    return { finding: f, opportunity: o, commercial };
  }).sort((a,b) => b.commercial - a.commercial);
  return ranked[0] || { finding: { code:'GENERAL_CONVERSION', severity:40, title:'Conversion journey can be improved', solution:'conversion-focused customer journey' }, opportunity: opportunityFor(), commercial: 40 };
}
